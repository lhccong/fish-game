import { useEffect, useState } from 'react';
import { FormattedMessage, useIntl } from 'react-intl';
import { CloudIcon, PlusIcon, RefreshCwIcon, SparklesIcon, UsersIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { JoinLinkInput } from '@/components/JoinLinkInput';
import { ScanJoinButton } from '@/components/ScanJoinButton';
import { AiCreationEntry, saveAiImportHandoff } from '@/components/editor/AiCreationEntry';
import {
  LobbyClient,
  lobbyServiceUrl,
  type LobbyRoom,
} from '../lib/lobbyApi';
import { buildJoinHashRoute, navigateToPeerJoin } from '../lib/peerRoutes';
import { loadLocalUser } from '../lib/localUser';
import { ENABLE_REPLAYS } from '../lib/featureFlags';

function RoomCover({ src }: { src: string | undefined }) {
  const [failed, setFailed] = useState(false);
  const showCover = Boolean(src) && !failed;
  return (
    <div className="flex aspect-video w-28 shrink-0 items-center justify-center overflow-hidden rounded-lg sm:w-36">
      <img
        src={showCover ? src : '/moyu.png'}
        alt=""
        loading="lazy"
        onError={() => setFailed(true)}
        className={showCover
          ? 'size-full object-cover'
          : 'h-full w-auto max-w-full rounded-lg object-contain'}
      />
    </div>
  );
}

/** 面向玩家的在线大厅。创作草稿与开发预览不在这里展示。 */
export function Lobby() {
  const intl = useIntl();
  const [online, setOnline] = useState<LobbyRoom[]>([]);
  const [onlineStatus, setOnlineStatus] = useState<'loading' | 'ready' | 'offline'>('loading');
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    const baseUrl = lobbyServiceUrl();
    if (!baseUrl) {
      setOnlineStatus('offline');
      setRefreshing(false);
      return;
    }
    const client = new LobbyClient(baseUrl);
    const viewerClientId = loadLocalUser().id;
    let active = true;
    let pending = false;
    const refresh = () => {
      if (pending) return;
      pending = true;
      setRefreshing(true);
      client
        .listRooms({ viewerClientId })
        .then((rooms) => {
          if (!active) return;
          setOnline(rooms);
          setOnlineStatus('ready');
        })
        .catch(() => {
          if (active) setOnlineStatus('offline');
        })
        .finally(() => {
          pending = false;
          if (active) setRefreshing(false);
        });
    };
    refresh();
    const timer = setInterval(refresh, 10_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [refreshKey]);

  const emptyState =
    'flex min-h-[230px] flex-col items-center justify-center gap-1 border-0 bg-transparent p-6 text-center text-muted-foreground shadow-none';

  return (
    <div className="mx-auto w-full max-w-[1360px]">
      <section className="flex flex-col items-center pt-8 pb-12 text-center sm:pt-12 sm:pb-16">
        <div className="mb-5 inline-flex items-center gap-2 text-sm text-muted-foreground">
          <span className="size-2 rounded-full bg-success" />
          <FormattedMessage id="lobby.hero.title" />
        </div>
        <div className="w-full min-w-0">
          <h1 className="mb-6 text-4xl leading-tight font-extrabold tracking-normal sm:text-6xl lg:text-7xl">
            摸鱼<span className="text-primary-bright">派对</span>
          </h1>
          <p className="mx-auto max-w-[640px] text-base leading-8 text-muted-foreground sm:text-xl">
            <FormattedMessage id="lobby.hero.description" />
          </p>
        </div>
        <div className="mt-10 flex w-full max-w-[1120px] flex-wrap items-center gap-4 rounded-[28px] border border-border bg-surface/90 p-4 text-left shadow-soft sm:gap-5 sm:px-7 lg:mt-12 lg:rounded-full lg:py-5">
          <div className="flex min-w-0 items-center gap-3 max-lg:flex-1 lg:mr-auto">
            <img src="/moyu.png" alt="" className="size-12 shrink-0 rounded-lg object-cover sm:size-14" />
            <span className="text-base font-semibold sm:text-lg">摸鱼派对</span>
          </div>
          <Button asChild size="lg" className="h-12 shrink-0 rounded-full px-5 sm:h-14 sm:px-7 sm:text-base">
            <a href="#/editor"><PlusIcon data-icon="inline-start" /><FormattedMessage id="lobby.hero.createRoom" /></a>
          </Button>
          <div className="flex min-w-0 basis-full items-start gap-2 pb-4 lg:basis-[400px] lg:pb-0 [&>div>div]:rounded-full sm:[&>div>div]:h-14 sm:[&>button]:size-14 sm:[&_input]:text-base">
            <JoinLinkInput />
            <ScanJoinButton />
          </div>
        </div>
        <div className="mt-5 flex max-w-full flex-wrap items-center justify-center gap-3 [&_button]:whitespace-normal sm:[&_button]:px-5 sm:[&_button]:py-3 sm:[&_button]:text-sm">
          <AiCreationEntry
            onGoAdd={(handoff) => {
              saveAiImportHandoff(handoff);
              window.location.hash = '#/editor/ai-import';
            }}
          />
          {ENABLE_REPLAYS && <Button asChild variant="outline" className="max-md:w-full"><a href="#/replays"><FormattedMessage id="replays.nav" /></a></Button>}
        </div>
      </section>

      <div className="flex flex-col gap-8">
        <section>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-border pb-5">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-2xl font-bold"><FormattedMessage id="lobby.hero.title" /></h2>
            {onlineStatus === 'ready' && (
              <span className="rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">
                {intl.formatMessage({ id: 'lobby.live.roomCount' }, { count: online.length })}
              </span>
            )}
            </div>
            <Button
              variant="outline"
              disabled={refreshing}
              onClick={() => {
                setRefreshing(true);
                setRefreshKey((key) => key + 1);
              }}
              title="刷新列表"
            >
              <RefreshCwIcon className={refreshing ? 'animate-spin' : ''} />
              {refreshing ? '刷新中' : '刷新列表'}
            </Button>
          </div>

          {onlineStatus === 'loading' && <div className={emptyState}><FormattedMessage id="lobby.loading" /></div>}
          {onlineStatus === 'offline' && (
            <Card className={emptyState}>
              <CloudIcon className="size-12 rounded-2xl bg-secondary p-3 text-primary-bright" aria-hidden="true" />
              <h3 className="mt-3 mb-[7px] text-[19px] font-semibold text-foreground"><FormattedMessage id="lobby.offline.title" /></h3>
              <p className="mb-[18px]"><FormattedMessage id="lobby.offline.description" /></p>
            </Card>
          )}
          {online.length === 0 && onlineStatus === 'ready' && (
            <Card className={emptyState}>
              <SparklesIcon className="size-12 rounded-2xl bg-secondary p-3 text-primary-bright" aria-hidden="true" />
              <h3 className="mt-3 mb-[7px] text-[19px] font-semibold text-foreground"><FormattedMessage id="lobby.empty.title" /></h3>
              <p className="mb-[18px]"><FormattedMessage id="lobby.empty.description" /></p>
            </Card>
          )}
          {online.length > 0 && (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,340px),1fr))] gap-5">
              {online.map((room) => (
                <Card
                  className="min-w-0 gap-5 rounded-lg border-border bg-surface py-5 shadow-sm transition-colors hover:border-primary-bright/50"
                  key={room.listingId}
                >
                  <CardHeader className="flex items-center gap-4 px-5">
                    <RoomCover
                      key={typeof room.metadata?.cover === 'string' ? room.metadata.cover : 'default'}
                      src={typeof room.metadata?.cover === 'string' ? room.metadata.cover : undefined}
                    />
                    <div className="min-w-0 flex-1">
                      <CardTitle className="text-lg leading-7 break-words">{room.title}</CardTitle>
                      <CardDescription className="mt-1 break-all">{room.packageName}</CardDescription>
                      {room.credentialRequired && <Badge variant="secondary" className="mt-2"><FormattedMessage id="lobby.room.passwordRequired" /></Badge>}
                    </div>
                  </CardHeader>
                  <CardFooter className="mx-5 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-transparent px-0 pt-5 pb-5">
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                      <UsersIcon className="size-4 text-success" aria-hidden="true" />
                      {room.maxPlayers === null
                        ? intl.formatMessage({ id: 'lobby.room.playersOnline' }, { count: room.playerCount })
                        : intl.formatMessage({ id: 'lobby.room.playersCapacity' }, { current: room.playerCount, max: room.maxPlayers })}
                    </span>
                    <Button
                      // 满员时，仅允许最近掉线的原玩家重新进入。
                      disabled={!room.joinable && !room.selfRejoinable}
                      onClick={() => {
                        const connectionInfo = room.connectionInfo ?? room.hostPeerId;
                        if (!connectionInfo) return;
                        navigateToPeerJoin(buildJoinHashRoute(room.roomId, connectionInfo, undefined, room.transportConfig ?? { adapter: 'peerjs' }));
                      }}
                    >
                      {room.joinable ? (
                        <FormattedMessage id="lobby.room.join" />
                      ) : room.selfRejoinable ? (
                        <FormattedMessage id="lobby.room.joinGame" />
                      ) : (
                        <FormattedMessage id="lobby.room.full" />
                      )}
                    </Button>
                  </CardFooter>
                </Card>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
