import { describe, expect, it } from 'vitest';
import { createIntl } from 'react-intl';
import { formatRoomError } from './formatErrors';
import { messagesByLocale } from './messages';

describe.each(['zh-CN', 'en-US'] as const)('connection diagnostics (%s)', (locale) => {
  const messages = messagesByLocale[locale];
  const intl = createIntl({ locale, messages });

  it.each([
    ['[PEER_SIGNAL_TIMEOUT]', 'signaling'],
    ['[PEER_DATA_TIMEOUT] ICE=checking; gathering=complete; connection=connecting; signaling=stable.', 'dataChannel'],
    ['[PEER_DATA_ICE_FAILED] ICE=failed.', 'dataChannel'],
    ['[PEER_DATA_HOST_UNAVAILABLE]', 'hostUnavailable'],
  ])('preserves the diagnostic code and states for %s', (diagnostic, key) => {
    expect(formatRoomError(intl, diagnostic)).toBe(
      `${messages[`peer.connectionError.${key}`]} ${diagnostic}`,
    );
  });

  it.each(['timeout', 'disconnected'])('preserves the package-stage error for %s', (code) => {
    const message = messages[`peer.fetchPackage.${code}`]!;
    expect(formatRoomError(intl, message)).toBe(message);
  });
});
