import { describe, expect, it } from 'vitest';
import { validateCustomRemote } from './customRemote';

const VALID_URL = 'http://192.168.1.5:9000/game/host_user/template_abc.zip';

describe('validateCustomRemote', () => {
  it('accepts a well-formed publicUrl', () => {
    const value = { publicUrl: VALID_URL };
    expect(validateCustomRemote(value)).toEqual(value);
  });

  it.each([
    { name: 'null', value: null },
    { name: 'string', value: 'http://192.168.1.5:9000/...' },
    { name: 'array', value: [] },
    { name: 'missing publicUrl', value: {} },
    { name: 'non-string publicUrl', value: { publicUrl: 123 } },
    { name: 'empty publicUrl', value: { publicUrl: '' } },
    { name: 'javascript: protocol', value: { publicUrl: 'javascript:alert(1)' } },
    { name: 'data: protocol', value: { publicUrl: 'data:application/zip;base64,UEsDBA' } },
    { name: 'file: protocol', value: { publicUrl: 'file:///etc/passwd' } },
    { name: 'not a URL', value: { publicUrl: 'not a url at all' } },
  ])('rejects $name', ({ value }) => {
    expect(() => validateCustomRemote(value)).toThrow();
  });
});
