module.exports = {
  testEnvironment: "jsdom",
  setupFiles: ["jest-webextension-mock"],
  collectCoverage: true,
  coverageDirectory: "coverage",
  coverageThreshold: {
    global: {
      branches: 0,
      functions: 0,
      lines: 0,
      statements: 0
    }
  }
};
