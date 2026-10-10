import { useEffect, useState, type ReactNode } from 'react';
import type { HostRuntime } from '@parti/core';
import { Avatar, Popover } from 'radix-ui';
import { ChevronDownIcon } from 'lucide-react';

export function OnlinePlayersDropdown({ host, children }: { host: HostRuntime; children: ReactNode }) {
  const [players, setPlayers] = useState(() => host.players.list());

  useEffect(() => {
    setPlayers(host.players.list());
    return host.playersChanged.on((next) => setPlayers([...next]));
  }, [host]);

  const online = players.filter((player) => player.status !== 'offline');

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="查看在线用户"
          title="查看在线用户"
          className="flex shrink-0 items-center gap-[7px] rounded-full border border-border bg-surface px-3.5 py-2 text-xs text-muted-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {children}
          <ChevronDownIcon className="size-3.5" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={10}
          collisionPadding={16}
          aria-label="在线用户列表"
          className="z-50 w-72 max-w-[calc(100vw-32px)] overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg outline-none"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">在线用户</h2>
            <span className="text-xs text-muted-foreground">{online.length} 人</span>
          </div>
          <ul className="max-h-[min(320px,50dvh)] overflow-y-auto p-2">
            {online.map((player) => (
              <li key={player.id} className="flex items-center gap-3 rounded-md px-2 py-2.5">
                <Avatar.Root className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-secondary">
                  <Avatar.Image src={player.avatar} alt="" className="size-full object-cover" referrerPolicy="no-referrer" />
                  <Avatar.Fallback className="text-sm font-semibold text-secondary-foreground">
                    {Array.from(player.name.trim())[0] || '?'}
                  </Avatar.Fallback>
                </Avatar.Root>
                <span className="min-w-0 flex-1 break-words text-sm">{player.name}</span>
                {player.role === 'host' && <span className="shrink-0 text-xs text-primary-bright">房主</span>}
              </li>
            ))}
            {online.length === 0 && <li className="px-2 py-6 text-center text-sm text-muted-foreground">暂无在线用户</li>}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
