// Each line breaks one rule of the offline audit. Never built.
import Foundation
import Network
import SafariServices
import UIKit

func breaksEveryRule() {
	let session = URLSession.shared
	let request = URLRequest(url: URL(fileURLWithPath: "/"))
	let connection = NWConnection(host: "x", port: 1, using: .tcp)
	let stream = CFStreamCreatePairWithSocketToHost
	let socket = URLSessionWebSocketTask.self
	let safari = SFSafariViewController.self
	UIApplication.shared.open(URL(fileURLWithPath: "/"))
	let site = "https://example.com"
}
