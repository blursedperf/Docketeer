// Allowed code that looks a little like what the rules look for. Never built.
import Foundation

final class Opener {
	var openFolder: URL?
	func open(location: String) -> Bool { true }
	func file() -> URL { URL(fileURLWithPath: "/tmp/notes.md") }
	// A comment naming URLSession, NWConnection and "https://example.com" is ignored.
	let scheme = "quire://app/index.html"
}
