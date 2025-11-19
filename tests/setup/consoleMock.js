const consoleMethods = ['log', 'info', 'warn', 'error', 'debug'];
const shouldMockConsole = process.env.ALLOW_CONSOLE_OUTPUT !== '1';

const originalConsole = consoleMethods.reduce((acc, method) => {
  acc[method] = console[method].bind(console);
  return acc;
}, {});

let capturedEntries = [];

if (shouldMockConsole) {
  consoleMethods.forEach(method => {
    console[method] = (...args) => {
      capturedEntries.push({ method, args });
    };
  });
}

beforeEach(() => {
  if (!shouldMockConsole) {
    return;
  }
  capturedEntries = [];
});

afterEach(() => {
  if (!shouldMockConsole) {
    return;
  }
  capturedEntries = [];
});

afterAll(() => {
  if (!shouldMockConsole) {
    return;
  }

  consoleMethods.forEach(method => {
    console[method] = originalConsole[method];
  });
});

function getConsoleOutput() {
  return capturedEntries.map(entry => ({
    method: entry.method,
    args: entry.args,
  }));
}

function consumeConsoleOutput() {
  const entries = getConsoleOutput();
  capturedEntries = [];
  return entries;
}

module.exports = {
  getConsoleOutput,
  consumeConsoleOutput,
};
