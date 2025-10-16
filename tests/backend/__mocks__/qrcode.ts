// Mock QRCode module for tests
const QRCode = {
  toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,mockQRCode'),
  create: jest.fn(),
  toCanvas: jest.fn(),
  toString: jest.fn(),
  toBuffer: jest.fn(),
  toFile: jest.fn(),
  toFileStream: jest.fn(),
};

module.exports = QRCode;
module.exports.default = QRCode;
