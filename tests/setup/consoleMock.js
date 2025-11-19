const consoleMethods = ['log', 'info', 'warn', 'error', 'debug'];

const originalConsole = consoleMethods.reduce((acc, method) => {
  acc[method] = console[method].bind(console);
  return acc;
}, {});

let capturedEntries = [];

const formatArg = (arg) => {
  if (typeof arg === 'string') {
    return arg;
  }
  if (arg instanceof Error) {
    return `${arg.name}: ${arg.message}`;
  }
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
};

beforeEach(() => {
  if (process.env.ALLOW_CONSOLE_OUTPUT === '1') {
    return;
  }

  capturedEntries = [];

  consoleMethods.forEach(method => {
    jest.spyOn(console, method).mockImplementation((...args) => {
      capturedEntries.push({ method, args });
    });
  });
});

afterEach(() => {
  if (process.env.ALLOW_CONSOLE_OUTPUT === '1') {
    return;
  }

  consoleMethods.forEach(method => {
    const spy = console[method];
    if (spy && typeof spy.mockRestore === 'function') {
      spy.mockRestore();
    }
    console[method] = originalConsole[method];
  });

  capturedEntries = [];
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
