#!/usr/bin/env ruby
# Adds and configures the native targets of stage 3B in ios/App/App.xcodeproj,
# with the xcodeproj gem (it ships with CocoaPods; `gem install xcodeproj`).
# project.pbxproj is never edited by hand.
#
#   ruby ios/scripts/native_targets.rb
#
# Idempotent: run it again after adding a Swift file and it only adds what is
# missing. A target is created once its source folder exists.
#
#   App                    com.buzz.pepito                     iPhone app (existing)
#   PepitoWidgets          com.buzz.pepito.widgets             widgets + sauna Live Activity
#   PepitoWatch            com.buzz.pepito.watchkitapp         Apple Watch app
#   PepitoWatchWidgets     com.buzz.pepito.watchkitapp.widgets complications and Smart Stack
#
# Features the signing account may not allow are switched in
# ios/native-features.json: each one off is left out of the entitlements and
# reported to the code through the PepitoFeatures key in every Info.plist.
require 'xcodeproj'
require 'json'
require 'fileutils'

IOS = File.expand_path('..', __dir__)
PROJECT_PATH = File.join(IOS, 'App', 'App.xcodeproj')
SRCROOT = File.join(IOS, 'App')
FEATURES = { 'appGroup' => true, 'timeSensitive' => true, 'watchHealthKit' => true, 'liveActivities' => true }
  .merge(JSON.parse(File.read(File.join(IOS, 'native-features.json'))))
APP_GROUP = 'group.com.buzz.pepito'
IOS_TARGET = '17.0'
WATCH_TARGET = '10.0'
BUNDLE = 'com.buzz.pepito'

project = Xcodeproj::Project.open(PROJECT_PATH)
app = project.targets.find { |t| t.name == 'App' } or abort('App target not found')

def rel(path) = Pathname.new(path).relative_path_from(Pathname.new(SRCROOT)).to_s

# ---------------------------------------------------------------- helpers

def group_for(project, dir)
  path = rel(dir)
  project.main_group.children.find { |g| g.isa == 'PBXGroup' && g.path == path } ||
    project.main_group.new_group(File.basename(dir), path)
end

# Add every .swift file under `dir` to `target` (missing ones only).
def add_sources(project, target, dir, group = nil)
  return unless Dir.exist?(dir)
  group ||= group_for(project, dir)
  existing = target.source_build_phase.files_references.map { |f| f&.real_path&.to_s }
  Dir.glob(File.join(dir, '**', '*.swift')).sort.each do |file|
    sub = File.dirname(file)
    g = sub == dir ? group : nested_group(group, dir, sub)
    ref = g.files.find { |f| f.real_path.to_s == file } || g.new_reference(File.basename(file))
    target.source_build_phase.add_file_reference(ref, true) unless existing.include?(file)
  end
end

def nested_group(root, base, sub)
  Pathname.new(sub).relative_path_from(Pathname.new(base)).each_filename.reduce(root) do |g, part|
    g.children.find { |c| c.isa == 'PBXGroup' && c.path == part } || g.new_group(part, part)
  end
end

def add_resource(project, target, path, group)
  return unless File.exist?(path)
  ref = group.files.find { |f| f.real_path.to_s == path } || group.new_reference(File.basename(path))
  target.resources_build_phase.add_file_reference(ref, true) unless target.resources_build_phase.files_references.include?(ref)
end

def kit_package(project)
  project.root_object.package_references.find { |r| r.respond_to?(:relative_path) && r.relative_path == '../PepitoKit' } ||
    project.new(Xcodeproj::Project::Object::XCLocalSwiftPackageReference).tap do |p|
      p.relative_path = '../PepitoKit'
      project.root_object.package_references << p
    end
end

def link_product(project, target, product)
  return if target.package_product_dependencies.any? { |d| d.product_name == product }
  dep = project.new(Xcodeproj::Project::Object::XCSwiftPackageProductDependency)
  dep.package = kit_package(project)
  dep.product_name = product
  target.package_product_dependencies << dep
  bf = project.new(Xcodeproj::Project::Object::PBXBuildFile)
  bf.product_ref = dep
  target.frameworks_build_phase.files << bf
end

def write_plist(path, hash)
  FileUtils.mkdir_p(File.dirname(path))
  Xcodeproj::Plist.write_to_path(hash, path)
end

def entitlements(path, keys)
  write_plist(path, keys)
end

def embed(project, host, product_target, name, spec, dst_path = '')
  phase = host.copy_files_build_phases.find { |p| p.name == name } || host.new_copy_files_build_phase(name).tap do |p|
    p.symbol_dst_subfolder_spec = spec
    p.dst_path = dst_path
  end
  unless phase.files_references.include?(product_target.product_reference)
    bf = phase.add_file_reference(product_target.product_reference, true)
    bf.settings = { 'ATTRIBUTES' => ['RemoveHeaderOnCopy'] }
  end
  host.add_dependency(product_target) unless host.dependencies.any? { |d| d.target == product_target }
end

def configure(target, settings)
  target.build_configurations.each do |c|
    settings.each { |k, v| c.build_settings[k] = v }
  end
end

def find_or_create(project, name, type, platform, version)
  target = project.targets.find { |t| t.name == name } ||
           project.new_target(type, name, platform, version, nil, :swift)
  # new_target links Foundation by an SDK-versioned path; Swift links it on
  # its own, and a path naming one Xcode's SDK breaks the build on another
  target.frameworks_build_phase.files.select { |f| f.file_ref&.path.to_s.end_with?('Foundation.framework') }.each do |f|
    ref = f.file_ref
    f.remove_from_project
    ref.remove_from_project if ref.build_files.empty?
  end
  target
end

features_plist = FEATURES.slice('appGroup', 'timeSensitive', 'watchHealthKit', 'liveActivities')

# ---------------------------------------------------------------- App

configure(app, 'IPHONEOS_DEPLOYMENT_TARGET' => IOS_TARGET)
project.build_configurations.each { |c| c.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = IOS_TARGET }
app_group = project.main_group.children.find { |g| g.isa == 'PBXGroup' && g.path == 'App' } or abort('App group not found')
add_sources(project, app, File.join(SRCROOT, 'App', 'Native'), nested_group(app_group, File.join(SRCROOT, 'App'), File.join(SRCROOT, 'App', 'Native')))
add_sources(project, app, File.join(IOS, 'Shared'))
link_product(project, app, 'PepitoCore')
link_product(project, app, 'PepitoTheme')

app_ent = { 'com.apple.developer.healthkit' => true, 'com.apple.developer.healthkit.access' => [] }
app_ent['com.apple.security.application-groups'] = [APP_GROUP] if FEATURES['appGroup']
app_ent['com.apple.developer.usernotifications.time-sensitive'] = true if FEATURES['timeSensitive']
entitlements(File.join(SRCROOT, 'App', 'App.entitlements'), app_ent)

info_path = File.join(SRCROOT, 'App', 'Info.plist')
info = Xcodeproj::Plist.read_from_path(info_path)
info['PepitoFeatures'] = features_plist
info['NSSupportsLiveActivities'] = FEATURES['liveActivities']
info['INAlternativeAppNames'] = [{ 'INAlternativeAppName' => 'Pepito' }]
info['NSFaceIDUsageDescription'] = 'Pepito+ uses Face ID to unlock the app when the lock is on in More, Settings.'
info['NSHealthUpdateUsageDescription'] = 'Pepito+ asks so the sauna on your Apple Watch can be started from your iPhone. The iPhone app never writes to Health.'
write_plist(info_path, info)

# ---------------------------------------------------------------- Widgets

widgets_dir = File.join(IOS, 'PepitoWidgets')
if Dir.exist?(widgets_dir)
  w = find_or_create(project, 'PepitoWidgets', :app_extension, :ios, IOS_TARGET)
  add_sources(project, w, widgets_dir)
  add_sources(project, w, File.join(IOS, 'Shared'))
  link_product(project, w, 'PepitoCore')
  link_product(project, w, 'PepitoTheme')
  w_ent = {}
  w_ent['com.apple.security.application-groups'] = [APP_GROUP] if FEATURES['appGroup']
  entitlements(File.join(widgets_dir, 'PepitoWidgets.entitlements'), w_ent)
  write_plist(File.join(widgets_dir, 'Info.plist'), {
    'CFBundleDevelopmentRegion' => '$(DEVELOPMENT_LANGUAGE)',
    'CFBundleDisplayName' => 'Pepito+',
    'CFBundleExecutable' => '$(EXECUTABLE_NAME)',
    'CFBundleIdentifier' => '$(PRODUCT_BUNDLE_IDENTIFIER)',
    'CFBundleInfoDictionaryVersion' => '6.0',
    'CFBundleName' => '$(PRODUCT_NAME)',
    'CFBundlePackageType' => '$(PRODUCT_BUNDLE_PACKAGE_TYPE)',
    'CFBundleShortVersionString' => '$(MARKETING_VERSION)',
    'CFBundleVersion' => '$(CURRENT_PROJECT_VERSION)',
    'NSExtension' => { 'NSExtensionPointIdentifier' => 'com.apple.widgetkit-extension' },
    'PepitoFeatures' => features_plist
  })
  configure(w, {
    'PRODUCT_BUNDLE_IDENTIFIER' => "#{BUNDLE}.widgets",
    'PRODUCT_NAME' => '$(TARGET_NAME)',
    'INFOPLIST_FILE' => rel(File.join(widgets_dir, 'Info.plist')),
    'GENERATE_INFOPLIST_FILE' => 'NO',
    'CODE_SIGN_ENTITLEMENTS' => rel(File.join(widgets_dir, 'PepitoWidgets.entitlements')),
    'CODE_SIGN_STYLE' => 'Automatic',
    'IPHONEOS_DEPLOYMENT_TARGET' => IOS_TARGET,
    'SWIFT_VERSION' => '5.0',
    'TARGETED_DEVICE_FAMILY' => '1,2',
    'SKIP_INSTALL' => 'YES',
    'MARKETING_VERSION' => '1.0',
    'CURRENT_PROJECT_VERSION' => '1',
    'LD_RUNPATH_SEARCH_PATHS' => ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks'],
    'APPLICATION_EXTENSION_API_ONLY' => 'YES',
    'SWIFT_ACTIVE_COMPILATION_CONDITIONS' => '$(inherited) WIDGET_EXTENSION',
    'ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME' => '',
    'ASSETCATALOG_COMPILER_WIDGET_BACKGROUND_COLOR_NAME' => ''
  })
  embed(project, app, w, 'Embed Foundation Extensions', :plug_ins)
end

# ---------------------------------------------------------------- Watch app

watch_dir = File.join(IOS, 'PepitoWatch')
watch_shared = File.join(IOS, 'WatchShared')
if Dir.exist?(watch_dir)
  wa = find_or_create(project, 'PepitoWatch', :application, :watchos, WATCH_TARGET)
  add_sources(project, wa, watch_dir)
  add_sources(project, wa, watch_shared)
  wa_group = group_for(project, watch_dir)
  add_resource(project, wa, File.join(watch_dir, 'Assets.xcassets'), wa_group)
  link_product(project, wa, 'PepitoCore')
  link_product(project, wa, 'PepitoTheme')
  wa_ent = {}
  if FEATURES['watchHealthKit']
    wa_ent['com.apple.developer.healthkit'] = true
    wa_ent['com.apple.developer.healthkit.access'] = []
  end
  wa_ent['com.apple.security.application-groups'] = [APP_GROUP] if FEATURES['appGroup']
  entitlements(File.join(watch_dir, 'PepitoWatch.entitlements'), wa_ent)
  write_plist(File.join(watch_dir, 'Info.plist'), {
    'CFBundleDevelopmentRegion' => '$(DEVELOPMENT_LANGUAGE)',
    'CFBundleDisplayName' => 'Pepito+',
    'CFBundleExecutable' => '$(EXECUTABLE_NAME)',
    'CFBundleIdentifier' => '$(PRODUCT_BUNDLE_IDENTIFIER)',
    'CFBundleInfoDictionaryVersion' => '6.0',
    'CFBundleName' => '$(PRODUCT_NAME)',
    'CFBundlePackageType' => '$(PRODUCT_BUNDLE_PACKAGE_TYPE)',
    'CFBundleShortVersionString' => '$(MARKETING_VERSION)',
    'CFBundleVersion' => '$(CURRENT_PROJECT_VERSION)',
    'WKApplication' => true,
    'WKCompanionAppBundleIdentifier' => BUNDLE,
    'WKBackgroundModes' => ['workout-processing'],
    'CFBundleURLTypes' => [{ 'CFBundleURLName' => "#{BUNDLE}.watchkitapp", 'CFBundleURLSchemes' => ['pepito'] }],
    'NSHealthShareUsageDescription' => 'Pepito+ reads your heart rate during a sauna session to show it live and in the summary.',
    'NSHealthUpdateUsageDescription' => 'Pepito+ saves each sauna session as a workout in Health, with its heart rate.',
    'PepitoFeatures' => features_plist
  })
  configure(wa, {
    'PRODUCT_BUNDLE_IDENTIFIER' => "#{BUNDLE}.watchkitapp",
    'PRODUCT_NAME' => '$(TARGET_NAME)',
    'INFOPLIST_FILE' => rel(File.join(watch_dir, 'Info.plist')),
    'GENERATE_INFOPLIST_FILE' => 'NO',
    'CODE_SIGN_ENTITLEMENTS' => rel(File.join(watch_dir, 'PepitoWatch.entitlements')),
    'CODE_SIGN_STYLE' => 'Automatic',
    'SDKROOT' => 'watchos',
    'WATCHOS_DEPLOYMENT_TARGET' => WATCH_TARGET,
    'SWIFT_VERSION' => '5.0',
    'TARGETED_DEVICE_FAMILY' => '4',
    'SKIP_INSTALL' => 'YES',
    'MARKETING_VERSION' => '1.0',
    'CURRENT_PROJECT_VERSION' => '1',
    'ASSETCATALOG_COMPILER_APPICON_NAME' => 'AppIcon',
    'ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME' => 'AccentColor',
    'LD_RUNPATH_SEARCH_PATHS' => ['$(inherited)', '@executable_path/Frameworks'],
    'ENABLE_PREVIEWS' => 'YES'
  })
  # a watchOS app sits inside the iPhone app's Watch folder
  embed(project, app, wa, 'Embed Watch Content', :products_directory, '$(CONTENTS_FOLDER_PATH)/Watch')
end

# ---------------------------------------------------------------- Watch widgets

watch_widgets_dir = File.join(IOS, 'PepitoWatchWidgets')
if Dir.exist?(watch_widgets_dir) && (wa = project.targets.find { |t| t.name == 'PepitoWatch' })
  ww = find_or_create(project, 'PepitoWatchWidgets', :app_extension, :watchos, WATCH_TARGET)
  add_sources(project, ww, watch_widgets_dir)
  add_sources(project, ww, watch_shared)
  link_product(project, ww, 'PepitoCore')
  link_product(project, ww, 'PepitoTheme')
  ww_ent = {}
  ww_ent['com.apple.security.application-groups'] = [APP_GROUP] if FEATURES['appGroup']
  entitlements(File.join(watch_widgets_dir, 'PepitoWatchWidgets.entitlements'), ww_ent)
  write_plist(File.join(watch_widgets_dir, 'Info.plist'), {
    'CFBundleDevelopmentRegion' => '$(DEVELOPMENT_LANGUAGE)',
    'CFBundleDisplayName' => 'Pepito+',
    'CFBundleExecutable' => '$(EXECUTABLE_NAME)',
    'CFBundleIdentifier' => '$(PRODUCT_BUNDLE_IDENTIFIER)',
    'CFBundleInfoDictionaryVersion' => '6.0',
    'CFBundleName' => '$(PRODUCT_NAME)',
    'CFBundlePackageType' => '$(PRODUCT_BUNDLE_PACKAGE_TYPE)',
    'CFBundleShortVersionString' => '$(MARKETING_VERSION)',
    'CFBundleVersion' => '$(CURRENT_PROJECT_VERSION)',
    'NSExtension' => { 'NSExtensionPointIdentifier' => 'com.apple.widgetkit-extension' },
    'PepitoFeatures' => features_plist
  })
  configure(ww, {
    'PRODUCT_BUNDLE_IDENTIFIER' => "#{BUNDLE}.watchkitapp.widgets",
    'PRODUCT_NAME' => '$(TARGET_NAME)',
    'INFOPLIST_FILE' => rel(File.join(watch_widgets_dir, 'Info.plist')),
    'GENERATE_INFOPLIST_FILE' => 'NO',
    'CODE_SIGN_ENTITLEMENTS' => rel(File.join(watch_widgets_dir, 'PepitoWatchWidgets.entitlements')),
    'CODE_SIGN_STYLE' => 'Automatic',
    'SDKROOT' => 'watchos',
    'WATCHOS_DEPLOYMENT_TARGET' => WATCH_TARGET,
    'SWIFT_VERSION' => '5.0',
    'TARGETED_DEVICE_FAMILY' => '4',
    'SKIP_INSTALL' => 'YES',
    'MARKETING_VERSION' => '1.0',
    'CURRENT_PROJECT_VERSION' => '1',
    'LD_RUNPATH_SEARCH_PATHS' => ['$(inherited)', '@executable_path/Frameworks', '@executable_path/../../Frameworks'],
    'APPLICATION_EXTENSION_API_ONLY' => 'YES'
  })
  embed(project, wa, ww, 'Embed Foundation Extensions', :plug_ins)
end

# groups left empty (the per-platform Frameworks groups new_target makes, an empty shared folder)
def prune_empty(group)
  group.children.select { |c| c.isa == 'PBXGroup' }.each { |c| prune_empty(c) }
  group.remove_from_project if group.children.empty? && group != group.project.main_group
end
project.main_group.children.select { |c| c.isa == 'PBXGroup' && %w[Frameworks WatchShared].include?(c.display_name) }.each { |g| prune_empty(g) }

project.save
puts "Targets: #{project.targets.map(&:name).join(', ')}"
puts "Features: #{FEATURES.map { |k, v| "#{k}=#{v}" }.join(' ')}"
