import { version } from 'react';
import { version as domVersion } from 'react-dom';

test('runs against the requested React major version', () => {
  const major = process.env.REACT_VERSION === '18' ? '18' : '19';
  expect(version.split('.')[0]).toBe(major);
  expect(domVersion.split('.')[0]).toBe(major);
});
