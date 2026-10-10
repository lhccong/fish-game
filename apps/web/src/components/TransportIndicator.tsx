import { useIntl } from 'react-intl';
import { ServerIcon } from 'lucide-react';

export function TransportIndicator() {
  const intl = useIntl();
  const label = intl.formatMessage({ id: 'user.settings.transport.relay.optionLabel' });
  const accessibleLabel = intl.formatMessage({ id: 'app.header.syncMethod' }, { method: label });

  return (
    <span
      className="inline-flex size-9 items-center justify-center text-muted-foreground"
      role="img"
      aria-label={accessibleLabel}
      title={accessibleLabel}
    >
      <ServerIcon className="size-5" aria-hidden="true" />
    </span>
  );
}
