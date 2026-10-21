import XCTest

/// Exercises a real order, close, and learning/profile persistence through the UI.
final class BrokieUITests: XCTestCase {
    @MainActor
    func testPaperTradingLearningAndSquadPersistence() throws {
        continueAfterFailure = false
        let app = XCUIApplication()
        app.launchArguments = ["--uitesting"]
        app.launch()

        let gold = app.buttons["market-gold"]
        XCTAssertTrue(gold.waitForExistence(timeout: 10))
        gold.tap()
        app.buttons["toggle-prices"].tap()
        for style in ["line", "candles"] {
            let chip = app.buttons["chart-style-\(style)"]
            reveal(chip, in: app)
            chip.tap()
        }
        let slowCandles = app.buttons["chart-frame-20"]
        reveal(slowCandles, in: app)
        slowCandles.tap()
        reveal(app.buttons["go-long"], in: app)
        app.buttons["go-long"].tap()
        XCTAssertTrue(app.buttons["quantity-2"].waitForExistence(timeout: 5))
        app.buttons["quantity-2"].tap()
        app.buttons["confirm-order"].tap()

        let close = app.buttons["close-position"].firstMatch
        reveal(close, in: app)
        XCTAssertTrue(app.staticTexts["Gold · Long"].exists)
        XCTAssertTrue(app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", "2 micro · at")).firstMatch.exists)
        close.tap()
        XCTAssertTrue(app.staticTexts["No bags. Yet."].waitForExistence(timeout: 5))

        app.buttons["tab-you"].tap()
        let receipt = app.staticTexts["Gold · Long · 2 micro"]
        reveal(receipt, in: app)
        XCTAssertTrue(receipt.exists)

        app.buttons["tab-learn"].tap()
        let lesson = app.buttons["lesson-0"]
        reveal(lesson, in: app)
        lesson.tap()
        let answer = app.buttons["answer-0"]
        reveal(answer, in: app)
        answer.tap()
        let done = app.buttons["Done"]
        reveal(done, in: app, down: true)
        done.tap()
        XCTAssertTrue(app.staticTexts["1 of 3 essentials complete"].waitForExistence(timeout: 5))

        app.buttons["tab-squad"].tap()
        let joinVoice = app.buttons["voice-join-squad"]
        reveal(joinVoice, in: app)
        joinVoice.tap()
        let voiceStatus = app.staticTexts["voice-status"]
        XCTAssertTrue(voiceStatus.waitForExistence(timeout: 5))
        XCTAssertEqual(voiceStatus.label, "Preview · muted")
        let mute = app.buttons["voice-mute"]
        reveal(mute, in: app)
        mute.tap()
        XCTAssertTrue(app.staticTexts["Preview · mic on"].waitForExistence(timeout: 5))
        app.buttons["tab-trade"].tap()
        XCTAssertTrue(app.buttons["voice-minibar"].waitForExistence(timeout: 5))
        app.buttons["voice-minibar"].tap()
        let leave = app.buttons["voice-leave"]
        reveal(leave, in: app)
        leave.tap()
        XCTAssertTrue(app.buttons["voice-join-squad"].waitForExistence(timeout: 5))

        let customize = app.buttons["create-squad"]
        reveal(customize, in: app)
        customize.tap()
        let field = app.textFields["squad-name"]
        XCTAssertTrue(field.waitForExistence(timeout: 5))
        field.tap()
        let original = field.value as? String ?? ""
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: original.count) + "Paper Legends")
        let save = app.buttons["Save squad name"]
        XCTAssertTrue(save.isHittable)
        save.tap()
        XCTAssertTrue(app.staticTexts["Paper Legends"].waitForExistence(timeout: 5))

        // Relaunch against the same isolated suite to verify saved user work.
        app.terminate()
        app.launchArguments = ["--uitesting", "--preserve-ui-state"]
        app.launch()
        app.buttons["tab-learn"].tap()
        XCTAssertTrue(app.staticTexts["1 of 3 essentials complete"].waitForExistence(timeout: 5))
        app.buttons["tab-squad"].tap()
        XCTAssertTrue(app.staticTexts["Paper Legends"].waitForExistence(timeout: 5))
        app.buttons["tab-you"].tap()
        reveal(app.staticTexts["Gold · Long · 2 micro"], in: app)
        XCTAssertTrue(app.staticTexts["Gold · Long · 2 micro"].exists)

        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "Completed trade and persistent account"
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }

    @MainActor
    private func reveal(_ element: XCUIElement, in app: XCUIApplication, down: Bool = false, file: StaticString = #filePath, line: UInt = #line) {
        _ = element.waitForExistence(timeout: 5)
        for _ in 0..<6 where !element.isHittable {
            if down || (element.exists && element.frame.midY < app.frame.minY + 130) {
                app.swipeDown()
            } else {
                app.swipeUp()
            }
        }
        XCTAssertTrue(element.isHittable, "Expected UI element to be visible: \(element)", file: file, line: line)
    }
}
