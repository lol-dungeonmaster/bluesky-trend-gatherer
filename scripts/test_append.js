const fs = require('fs');
let code = fs.readFileSync('tests/background.test.js', 'utf8');

const additionalTests = `
    it("should intercept GET requests and filter payload data", async () => {
        jest.isolateModules(() => { require('../background.src.js'); });
        await new Promise(r => setTimeout(r, 50));
        await messageListeners[0]({ command: "SET_STATE", isActive: true }, {}, jest.fn());

        const filterMock = {
            onstart: null,
            ondata: null,
            onstop: null,
            write: jest.fn(),
            disconnect: jest.fn(),
            close: jest.fn()
        };
        browser.webRequest.filterResponseData = jest.fn().mockReturnValue(filterMock);

        const onBeforeRequest = requestListeners.find(cb => true); 
        // wait, requestListeners is onBeforeSendHeaders. 
        // We didn't capture onBeforeRequest listeners!
    });
`;
