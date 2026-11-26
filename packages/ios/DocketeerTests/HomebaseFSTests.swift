import XCTest
@testable import Docketeer

/** The homebase on disk: path checks, hidden files, atomic writes, rename, copy, trash (decisions.md §5). */
final class HomebaseFSTests: XCTestCase {
	private var base: URL!
	private var root: URL!
	private var outside: URL!
	private var fs: HomebaseFS!

	override func setUpWithError() throws {
		base = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
		root = base.appendingPathComponent("Homebase")
		outside = base.appendingPathComponent("Outside")
		for dir in [root!, outside!, root.appendingPathComponent("Torts/Negligence"), root.appendingPathComponent(".quire")] {
			try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
		}
		try "# Welcome".write(to: root.appendingPathComponent("Welcome.md"), atomically: true, encoding: .utf8)
		try "duty".write(to: root.appendingPathComponent("Torts/Negligence/Duty of care.md"), atomically: true, encoding: .utf8)
		try "{}".write(to: root.appendingPathComponent(".quire/units.json"), atomically: true, encoding: .utf8)
		try "secret".write(to: outside.appendingPathComponent("secret.md"), atomically: true, encoding: .utf8)
		try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("Escape"), withDestinationURL: outside)
		try FileManager.default.createSymbolicLink(at: root.appendingPathComponent("Dangling.md"), withDestinationURL: outside.appendingPathComponent("not-yet.md"))
		fs = try HomebaseFS(root: root)
	}

	override func tearDownWithError() throws {
		try? FileManager.default.removeItem(at: base)
	}

	private func text(_ rel: String) throws -> String {
		try String(contentsOf: root.appendingPathComponent(rel), encoding: .utf8)
	}

	// MARK: Paths

	func testPathsInsideResolve() throws {
		XCTAssertEqual(try fs.resolve("Welcome.md").path, root.appendingPathComponent("Welcome.md").path)
		XCTAssertEqual(try fs.resolve("/Torts/./Negligence/../Negligence/Duty of care.md").lastPathComponent, "Duty of care.md")
		XCTAssertEqual(try fs.resolve("").path, root.path)
		XCTAssertEqual(try fs.resolve("New folder/New note.md").lastPathComponent, "New note.md", "paths that do not exist yet")
	}

	func testEscapesAreRefused() {
		for rel in ["..", "../Outside/secret.md", "Torts/../../Outside/secret.md", "a\0b.md", "Escape/secret.md", "Escape/new.md", "Dangling.md"] {
			XCTAssertThrowsError(try fs.resolve(rel), rel)
		}
		for bad: Any? in [nil, 3, ["Welcome.md"]] {
			XCTAssertThrowsError(try fs.resolve(bad))
		}
		XCTAssertThrowsError(try fs.write("Escape/new.md", Data("x".utf8)))
		XCTAssertThrowsError(try fs.read("Escape/secret.md"))
		XCTAssertFalse(FileManager.default.fileExists(atPath: outside.appendingPathComponent("new.md").path))
	}

	func testTheRootCannotBeRemoved() {
		XCTAssertThrowsError(try fs.rmdir("", recursive: true))
		XCTAssertThrowsError(try fs.rmdir("/", recursive: true))
		XCTAssertThrowsError(try fs.trash(""))
		XCTAssertThrowsError(try fs.rename("", "Elsewhere"))
		XCTAssertTrue(FileManager.default.fileExists(atPath: root.path))
	}

	// MARK: Listing

	func testTreeSkipsHiddenNamesAndSymlinks() throws {
		let paths = try fs.tree("").map(\.path)
		XCTAssertEqual(paths, ["Torts", "Torts/Negligence", "Torts/Negligence/Duty of care.md", "Welcome.md"])
		XCTAssertEqual(try fs.tree("Torts").map(\.path), ["Torts/Negligence", "Torts/Negligence/Duty of care.md"])
		let welcome = try XCTUnwrap(try fs.tree("").first { $0.path == "Welcome.md" })
		XCTAssertEqual(welcome.stat.type, "file")
		XCTAssertEqual(welcome.stat.size, 9)
		XCTAssertGreaterThan(welcome.stat.mtime, 1_600_000_000_000, "milliseconds")
	}

	func testListIncludesHiddenNames() throws {
		let l = try fs.list("")
		XCTAssertEqual(l.folders, [".quire", "Torts"])
		XCTAssertEqual(l.files, ["Dangling.md", "Escape", "Welcome.md"], "symlinks are listed, not followed")
	}

	func testStatAndExists() throws {
		XCTAssertEqual(try fs.stat("Torts")?.type, "folder")
		XCTAssertNil(try fs.stat("Missing.md"))
		XCTAssertTrue(try fs.exists(".quire/units.json"))
		XCTAssertFalse(try fs.exists("Missing.md"))
	}

	// MARK: Writing

	func testWriteIsAtomicAndMakesFolders() throws {
		let st = try fs.write("Contracts/Formation/Offer.md", Data("offer".utf8))
		XCTAssertEqual(st.type, "file")
		XCTAssertEqual(st.size, 5)
		XCTAssertEqual(try text("Contracts/Formation/Offer.md"), "offer")
		try fs.write("Contracts/Formation/Offer.md", Data("acceptance".utf8))
		XCTAssertEqual(try fs.read("Contracts/Formation/Offer.md"), "acceptance")
		let left = try FileManager.default.contentsOfDirectory(atPath: root.appendingPathComponent("Contracts/Formation").path)
		XCTAssertEqual(left, ["Offer.md"], "no temporary file is left behind")
		XCTAssertThrowsError(try fs.write("Torts", Data("x".utf8)), "a folder is not replaced by a file")
	}

	func testBinaryRoundTripAndAppend() throws {
		let bytes = Data((0..<256).map { UInt8($0) })
		try fs.write("attachments/blob.bin", bytes)
		XCTAssertEqual(try fs.readBinary("attachments/blob.bin"), bytes)
		try fs.append("Log/today.md", Data("a".utf8))
		let st = try fs.append("Log/today.md", Data("b".utf8))
		XCTAssertEqual(try fs.read("Log/today.md"), "ab")
		XCTAssertEqual(st.size, 2)
	}

	func testRemoveAndRmdir() throws {
		XCTAssertThrowsError(try fs.remove("Torts"), "remove is for files")
		try fs.remove("Welcome.md")
		XCTAssertFalse(try fs.exists("Welcome.md"))
		XCTAssertThrowsError(try fs.rmdir("Torts", recursive: false), "not empty")
		try fs.mkdir("Empty")
		try fs.rmdir("Empty", recursive: false)
		try fs.rmdir("Torts", recursive: true)
		XCTAssertFalse(try fs.exists("Torts"))
	}

	func testRenameMovesAndReplaces() throws {
		try fs.rename("Welcome.md", "Archive/2026/Start here.md")
		XCTAssertFalse(try fs.exists("Welcome.md"))
		XCTAssertEqual(try fs.read("Archive/2026/Start here.md"), "# Welcome")
		try fs.write("Other.md", Data("other".utf8))
		try fs.rename("Other.md", "Archive/2026/Start here.md")
		XCTAssertEqual(try fs.read("Archive/2026/Start here.md"), "other")
		try fs.rename("Torts", "Law/Torts")
		XCTAssertTrue(try fs.exists("Law/Torts/Negligence/Duty of care.md"))
		XCTAssertThrowsError(try fs.rename("Missing.md", "x.md"))
		XCTAssertThrowsError(try fs.rename("Law", "../Outside/Law"))
	}

	func testCopyReplacesWhole() throws {
		try fs.write("B.md", Data("a much longer old text".utf8))
		try fs.copy("Welcome.md", "B.md")
		XCTAssertEqual(try fs.read("B.md"), "# Welcome")
		try fs.copy("Welcome.md", "Copies/Welcome.md")
		XCTAssertEqual(try fs.read("Copies/Welcome.md"), "# Welcome")
	}

	// MARK: The conflict guard

	/** Change a file as another device would: new text and a later modification time. */
	private func changeOnDisk(_ rel: String, _ text: String, secondsLater: TimeInterval = 5) throws {
		let url = root.appendingPathComponent(rel)
		try text.write(to: url, atomically: true, encoding: .utf8)
		try FileManager.default.setAttributes([.modificationDate: Date().addingTimeInterval(secondsLater)], ofItemAtPath: url.path)
	}

	func testAWriteOverAChangeOnDiskIsRefusedAsAConflict() throws {
		XCTAssertEqual(try fs.read("Welcome.md"), "# Welcome")
		try changeOnDisk("Welcome.md", "# Changed on the laptop")
		XCTAssertThrowsError(try fs.write("Welcome.md", Data("# Mine".utf8))) { e in
			XCTAssertEqual((e as? HomebaseError)?.code, "conflict")
		}
		XCTAssertEqual(try text("Welcome.md"), "# Changed on the laptop", "the other device's version is kept")
		XCTAssertThrowsError(try fs.write("Welcome.md", Data("# Mine".utf8)), "still refused until it is read again")

		// After reading the new version, writing is fine again.
		XCTAssertEqual(try fs.read("Welcome.md"), "# Changed on the laptop")
		try fs.write("Welcome.md", Data("# Both".utf8))
		XCTAssertEqual(try text("Welcome.md"), "# Both")
	}

	func testOwnWritesDoNotConflictAndNewFilesAreFree() throws {
		try fs.write("New.md", Data("1".utf8))
		try fs.write("New.md", Data("2".utf8))
		try fs.write("Pic.png", Data([1, 2]))
		try fs.write("Pic.png", Data([3]))
		try changeOnDisk("Torts/Negligence/Duty of care.md", "changed")
		try fs.write("Torts/Negligence/Duty of care.md", Data("never read here".utf8))
		XCTAssertEqual(try text("Torts/Negligence/Duty of care.md"), "never read here", "a file Docketeer never read is written as on desktop")
	}

	func testSettingsInQuireStayLastWriteWins() throws {
		_ = try fs.read(".quire/units.json")
		try changeOnDisk(".quire/units.json", "{\"other\":1}")
		try fs.write(".quire/units.json", Data("{}".utf8))
		XCTAssertEqual(try text(".quire/units.json"), "{}")
	}

	func testTheGuardFollowsRenamesAndForgetsRemovals() throws {
		_ = try fs.read("Torts/Negligence/Duty of care.md")
		try fs.rename("Torts", "Law/Torts")
		try changeOnDisk("Law/Torts/Negligence/Duty of care.md", "changed")
		XCTAssertThrowsError(try fs.write("Law/Torts/Negligence/Duty of care.md", Data("mine".utf8)))
		_ = try fs.read("Welcome.md")
		try fs.remove("Welcome.md")
		try changeOnDisk("Welcome.md", "new, from elsewhere")
		try fs.write("Welcome.md", Data("mine".utf8))
		XCTAssertEqual(try text("Welcome.md"), "mine", "a removed file's time is forgotten")
	}

	// MARK: iCloud downloads

	func testAStandInIsListedAsTheFileItIsForPending() throws {
		try "plist".write(to: root.appendingPathComponent("Torts/.Brief.md.icloud"), atomically: true, encoding: .utf8)
		try "plist".write(to: root.appendingPathComponent(".Hidden.md.icloud"), atomically: true, encoding: .utf8)
		let entry = try XCTUnwrap(try fs.tree("").first { $0.path == "Torts/Brief.md" })
		XCTAssertTrue(entry.stat.pending)
		XCTAssertEqual(entry.stat.json["pending"] as? Bool, true)
		XCTAssertFalse(try fs.tree("").contains { $0.path.hasSuffix(".icloud") || $0.path == ".Hidden.md" }, "the stand-in itself, and hidden files, are not listed")
		XCTAssertNil(try fs.tree("").first { $0.path == "Welcome.md" }?.stat.json["pending"], "files that are here have no pending")
		XCTAssertTrue(try fs.exists("Torts/Brief.md"))
		XCTAssertEqual(try fs.stat("Torts/Brief.md")?.pending, true)
		XCTAssertEqual(HomebaseFS.standInTarget(".Brief.md.icloud"), "Brief.md")
		XCTAssertNil(HomebaseFS.standInTarget(".icloud"))
		XCTAssertNil(HomebaseFS.standInTarget("Brief.md"))
	}

	func testReadingWaitsForTheDownloadThenSaysItIsStillComing() throws {
		let standIn = root.appendingPathComponent("Torts/.Brief.md.icloud")
		try "plist".write(to: standIn, atomically: true, encoding: .utf8)
		fs.downloadWait = 0.3
		XCTAssertThrowsError(try fs.read("Torts/Brief.md")) { e in
			XCTAssertTrue((e as? HomebaseError)?.message.contains("still downloading from iCloud") == true)
		}
		// iCloud brings it while Docketeer waits.
		fs.downloadWait = 5
		DispatchQueue.global().asyncAfter(deadline: .now() + 0.3) {
			try? "# Brief".write(to: self.root.appendingPathComponent("Torts/Brief.md"), atomically: true, encoding: .utf8)
			try? FileManager.default.removeItem(at: standIn)
		}
		XCTAssertEqual(try fs.read("Torts/Brief.md"), "# Brief")
		XCTAssertFalse(try fs.stat("Torts/Brief.md")!.pending)
	}

	// MARK: Versions from other devices

	private let syncthing = "Torts/Negligence/Duty of care.sync-conflict-20261127-090500-ABCDEFG.md"

	func testSyncthingNamesAreRecognised() {
		XCTAssertEqual(HomebaseFS.syncthingOriginal(syncthing)?.path, "Torts/Negligence/Duty of care.md")
		XCTAssertEqual(HomebaseFS.syncthingOriginal(syncthing)?.device, "ABCDEFG")
		XCTAssertEqual(HomebaseFS.syncthingOriginal("Notes.sync-conflict-20261127-090500-ABCDEFG")?.path, "Notes")
		XCTAssertNil(HomebaseFS.syncthingOriginal("Torts/Duty of care.md"))
		XCTAssertNil(HomebaseFS.syncthingOriginal("x.sync-conflict-2026-090500-ABCDEFG.md"))
	}

	func testASyncthingVersionIsListedAndReadAndOnlyWhenItsNoteIsThere() throws {
		try "theirs".write(to: root.appendingPathComponent(syncthing), atomically: true, encoding: .utf8)
		try "orphan".write(to: root.appendingPathComponent("Gone.sync-conflict-20261127-090500-ABCDEFG.md"), atomically: true, encoding: .utf8)
		let list = try fs.conflicts()
		XCTAssertEqual(list.count, 1)
		XCTAssertEqual(list.first?.path, "Torts/Negligence/Duty of care.md")
		XCTAssertEqual(list.first?.from, "Syncthing (device ABCDEFG)")
		XCTAssertEqual(try fs.readConflict(list.first?.id), "theirs")
	}

	func testKeepingThisDevicesVersionRemovesTheOther() throws {
		try "theirs".write(to: root.appendingPathComponent(syncthing), atomically: true, encoding: .utf8)
		try fs.resolveConflict(try fs.conflicts().first?.id, keep: "mine", copyPath: nil)
		XCTAssertEqual(try text("Torts/Negligence/Duty of care.md"), "duty")
		XCTAssertFalse(try fs.exists(syncthing))
		XCTAssertTrue(try fs.conflicts().isEmpty)
	}

	func testKeepingTheOtherVersionReplacesTheNote() throws {
		_ = try fs.read("Torts/Negligence/Duty of care.md")
		try "theirs".write(to: root.appendingPathComponent(syncthing), atomically: true, encoding: .utf8)
		try fs.resolveConflict(try fs.conflicts().first?.id, keep: "theirs", copyPath: nil)
		XCTAssertEqual(try text("Torts/Negligence/Duty of care.md"), "theirs")
		XCTAssertFalse(try fs.exists(syncthing))
	}

	func testKeepingBothPutsTheOtherAtTheCopyPath() throws {
		try "theirs".write(to: root.appendingPathComponent(syncthing), atomically: true, encoding: .utf8)
		let copy = "Torts/Negligence/Duty of care (conflict 2026-11-27 09.05).md"
		try fs.resolveConflict(try fs.conflicts().first?.id, keep: "both", copyPath: copy)
		XCTAssertEqual(try text("Torts/Negligence/Duty of care.md"), "duty")
		XCTAssertEqual(try text(copy), "theirs")
		XCTAssertFalse(try fs.exists(syncthing))
		XCTAssertTrue(try fs.conflicts().isEmpty)
	}

	func testBadVersionsAreRefused() throws {
		try "theirs".write(to: root.appendingPathComponent(syncthing), atomically: true, encoding: .utf8)
		let id = try XCTUnwrap(try fs.conflicts().first?.id)
		for bad: Any? in [nil, 3, "Welcome.md", "syncthing:Welcome.md", "syncthing:../Outside/x.sync-conflict-20261127-090500-ABCDEFG.md", "icloud:1:Welcome.md", "icloud:x:Welcome.md", "icloud:1:../Outside/secret.md"] {
			XCTAssertThrowsError(try fs.readConflict(bad), "\(String(describing: bad))")
			XCTAssertThrowsError(try fs.resolveConflict(bad, keep: "theirs", copyPath: nil), "\(String(describing: bad))")
		}
		XCTAssertThrowsError(try fs.resolveConflict(id, keep: "everything", copyPath: nil))
		XCTAssertThrowsError(try fs.resolveConflict(id, keep: "both", copyPath: nil), "keeping both needs a place for the copy")
		XCTAssertThrowsError(try fs.resolveConflict(id, keep: "both", copyPath: "../Outside/copy.md"))
		XCTAssertTrue(try fs.exists(syncthing), "nothing was removed")
		XCTAssertEqual(try text("Welcome.md"), "# Welcome")
	}

	func testTrashMovesItOutOfTheHomebaseTree() throws {
		XCTAssertTrue(try fs.trash("Welcome.md"))
		XCTAssertFalse(try fs.exists("Welcome.md"))
		XCTAssertFalse(try fs.tree("").map(\.path).contains("Welcome.md"))
		XCTAssertFalse(try fs.trash("Missing.md"))
	}
}

/** Changes made outside Docketeer, found by rescanning (decisions.md §5). */
final class HomebaseWatcherTests: XCTestCase {
	private var root: URL!
	private var fs: HomebaseFS!

	override func setUpWithError() throws {
		root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
		try FileManager.default.createDirectory(at: root.appendingPathComponent("Torts"), withIntermediateDirectories: true)
		try "a".write(to: root.appendingPathComponent("Torts/Duty.md"), atomically: true, encoding: .utf8)
		try "b".write(to: root.appendingPathComponent("Gone.md"), atomically: true, encoding: .utf8)
		fs = try HomebaseFS(root: root)
	}

	override func tearDownWithError() throws {
		try? FileManager.default.removeItem(at: root)
	}

	func testARescanReportsWhatChangedOutsideDocketeer() throws {
		let got = Got()
		let w = HomebaseWatcher(fs: fs) { got.events.append(contentsOf: $0) }
		w.start()
		defer { w.stop() }
		w.rescan()
		XCTAssertTrue(got.drain().isEmpty, "nothing changed")

		try "changed".write(to: root.appendingPathComponent("Torts/Duty.md"), atomically: true, encoding: .utf8)
		try FileManager.default.setAttributes([.modificationDate: Date().addingTimeInterval(5)], ofItemAtPath: root.appendingPathComponent("Torts/Duty.md").path)
		try FileManager.default.createDirectory(at: root.appendingPathComponent("Contracts"), withIntermediateDirectories: true)
		try "new".write(to: root.appendingPathComponent("Contracts/Offer.md"), atomically: true, encoding: .utf8)
		try "hidden".write(to: root.appendingPathComponent(".hidden.md"), atomically: true, encoding: .utf8)
		try FileManager.default.removeItem(at: root.appendingPathComponent("Gone.md"))
		w.rescan()
		let events = got.drain()
		XCTAssertEqual(events.map { $0["path"] as? String }, ["Contracts", "Contracts/Offer.md", "Torts/Duty.md", "Gone.md"], "folders before what is in them; hidden names skipped")
		XCTAssertEqual((events[2]["stat"] as? [String: Any])?["size"] as? Int, 7)
		XCTAssertTrue(events[3]["stat"] is NSNull, "gone")
		w.rescan()
		XCTAssertTrue(got.drain().isEmpty, "reported once")

		// A file iCloud had not downloaded arrives: reported, without pending.
		try "plist".write(to: root.appendingPathComponent(".Brief.md.icloud"), atomically: true, encoding: .utf8)
		w.rescan()
		let pending = got.drain()
		XCTAssertEqual(pending.first?["path"] as? String, "Brief.md")
		XCTAssertEqual((pending.first?["stat"] as? [String: Any])?["pending"] as? Bool, true)
		try FileManager.default.removeItem(at: root.appendingPathComponent(".Brief.md.icloud"))
		try "# Brief".write(to: root.appendingPathComponent("Brief.md"), atomically: true, encoding: .utf8)
		w.rescan()
		let arrived = got.drain()
		XCTAssertEqual(arrived.first?["path"] as? String, "Brief.md")
		XCTAssertNil((arrived.first?["stat"] as? [String: Any])?["pending"])
	}

	/** The events emitted (they arrive on the main thread). */
	private final class Got {
		var events: [[String: Any]] = []
		func drain() -> [[String: Any]] {
			RunLoop.main.run(until: Date().addingTimeInterval(0.05))
			defer { events = [] }
			return events
		}
	}
}
