describe("Initialization", () => {
  it("should have access to the mocked browser API", () => {
    expect(browser.tabs).toBeDefined();
    expect(browser.storage.local).toBeDefined();
  });
});
