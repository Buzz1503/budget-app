import Foundation
import UIKit
import AVFoundation
import Vision
import Capacitor

/**
 * PepitoCamera: what the progress photos need from iOS.
 *
 * - `status` and `request`: camera access, so a denied camera shows a message
 *   with a way to Settings instead of an empty camera.
 * - `openSettings`: the app's page in Settings.
 * - `detectPose`: Apple's Vision body pose detection on one photo, for Auto
 *   align. Only the joint positions come back (0 to 1, origin top left); the
 *   photo is read in memory and never leaves the phone.
 */
@objc(PepitoCameraPlugin)
public class PepitoCameraPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PepitoCameraPlugin"
    public let jsName = "PepitoCamera"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "status", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "detectPose", returnType: CAPPluginReturnPromise)
    ]

    private func word(_ s: AVAuthorizationStatus) -> String {
        switch s {
        case .authorized: return "granted"
        case .denied: return "denied"
        case .restricted: return "restricted"
        case .notDetermined: return "prompt"
        @unknown default: return "prompt"
        }
    }

    @objc func status(_ call: CAPPluginCall) {
        call.resolve(["camera": word(AVCaptureDevice.authorizationStatus(for: .video))])
    }

    @objc func request(_ call: CAPPluginCall) {
        AVCaptureDevice.requestAccess(for: .video) { _ in
            call.resolve(["camera": self.word(AVCaptureDevice.authorizationStatus(for: .video))])
        }
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else { call.resolve(["opened": false]); return }
            UIApplication.shared.open(url) { ok in call.resolve(["opened": ok]) }
        }
    }

    private static let joints: [(String, VNHumanBodyPoseObservation.JointName)] = [
        ("nose", .nose), ("neck", .neck),
        ("leftShoulder", .leftShoulder), ("rightShoulder", .rightShoulder),
        ("leftHip", .leftHip), ("rightHip", .rightHip), ("root", .root),
        ("leftKnee", .leftKnee), ("rightKnee", .rightKnee),
        ("leftAnkle", .leftAnkle), ("rightAnkle", .rightAnkle)
    ]

    /// `image`: a JPEG as base64. Answers `found` and `points` { name: { x, y, c } }.
    @objc func detectPose(_ call: CAPPluginCall) {
        guard let b64 = call.getString("image"),
              let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters),
              let image = UIImage(data: data)?.cgImage else {
            call.resolve(["found": false]); return
        }
        DispatchQueue.global(qos: .userInitiated).async {
            let request = VNDetectHumanBodyPoseRequest()
            let handler = VNImageRequestHandler(cgImage: image, orientation: .up, options: [:])
            do { try handler.perform([request]) } catch { call.resolve(["found": false]); return }
            // the person taking up most of the frame
            guard let body = (request.results ?? []).max(by: { a, b in
                let ra = (try? a.recognizedPoints(.all))?.values.filter { $0.confidence > 0.1 }.count ?? 0
                let rb = (try? b.recognizedPoints(.all))?.values.filter { $0.confidence > 0.1 }.count ?? 0
                return ra < rb
            }), let all = try? body.recognizedPoints(.all) else {
                call.resolve(["found": false]); return
            }
            var points: [String: Any] = [:]
            for (name, joint) in PepitoCameraPlugin.joints {
                guard let p = all[joint], p.confidence > 0.1 else { continue }
                points[name] = ["x": Double(p.location.x), "y": 1 - Double(p.location.y), "c": Double(p.confidence)]
            }
            call.resolve(["found": !points.isEmpty, "points": points])
        }
    }
}
