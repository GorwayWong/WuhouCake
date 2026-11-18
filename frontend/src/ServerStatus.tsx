import { useQuery } from '@tanstack/react-query';
import { readQuery } from './api';
import { time } from './dates';
import { ErrorNotice, Loading } from './ui';

const alerts = {
  DISK_LOW: '磁盘余量不足。请核对备份和发布目录占用。',
  DAILY_FAILED: '日常备份失败或长时间未完成。请查看服务器备份日志并补跑。',
  DAILY_OVERDUE: '日常备份已逾期。请检查定时任务并补跑。',
  PREDEPLOY_FAILED: '发布前备份失败或长时间未完成。请核对日志后再发布。',
};
const failures = {
  DUMP_FAILED: '数据库导出失败',
  DUMP_TIMEOUT: '数据库导出超时',
  VERIFY_FAILED: '备份验读失败',
  DISK_RESERVE: '磁盘余量不足',
  STORAGE_FAILED: '无法写入备份',
  INTERRUPTED: '备份进程中断',
};
type Backup = {
  latestAttempt: { state: 'RUNNING' | 'SUCCESS' | 'FAILED'; startedAt: string; finishedAt: string | null; error: keyof typeof failures | null } | null;
  lastSuccess: { verifiedAt: string; bytes: number } | null;
};
type ServerStatusView = { state: 'UNKNOWN' } | {
  state: 'AVAILABLE'; observedAt: string;
  disk: { totalBytes: number; availableBytes: number };
  daily: Backup; predeploy: Backup; alerts: (keyof typeof alerts)[];
};

export function useServerStatus(accountId?: string) {
  return useQuery({
    queryKey: ['admin', 'server-status', accountId],
    enabled: Boolean(accountId),
    queryFn: ({ signal }) => readQuery<ServerStatusView>('/admin/server-status', signal),
    refetchInterval: 60_000,
    retry: false,
  });
}

function bytes(value: number) {
  const unit = value >= 1024 ** 3 ? 'GiB' : value >= 1024 ** 2 ? 'MiB' : 'KiB';
  const scale = { GiB: 1024 ** 3, MiB: 1024 ** 2, KiB: 1024 }[unit];
  return `${(value / scale).toLocaleString('zh-CN', { maximumFractionDigits: 1 })} ${unit}`;
}

function BackupDetails({ title, backup }: { title: string; backup: Backup }) {
  const { latestAttempt, lastSuccess } = backup;
  return <section className="panel">
    <h2>{title}</h2>
    <dl className="server-status-facts">
      <div><dt>最近一次执行</dt><dd>{latestAttempt ? time(latestAttempt.finishedAt ?? latestAttempt.startedAt, true) : '暂无记录'}</dd></div>
      <div><dt>结果</dt><dd>{latestAttempt?.state === 'FAILED'
        ? latestAttempt.error ? failures[latestAttempt.error] : '失败'
        : latestAttempt?.state === 'SUCCESS' ? '校验通过' : latestAttempt?.state === 'RUNNING' ? '执行中' : '暂无记录'}</dd></div>
      <div><dt>最近校验成功</dt><dd>{lastSuccess ? time(lastSuccess.verifiedAt, true) : '暂无记录'}</dd></div>
      <div><dt>有效备份大小</dt><dd>{lastSuccess ? bytes(lastSuccess.bytes) : '暂无记录'}</dd></div>
    </dl>
  </section>;
}

export function ServerStatus({ query }: { query: ReturnType<typeof useServerStatus> }) {
  const status = query.isError ? undefined : query.data;
  return <div className="server-status">
    <div className="page-heading"><h1>服务器情况</h1>
      <button type="button" className="secondary" disabled={query.isFetching} onClick={() => void query.refetch()}>
        {query.isFetching ? '读取中…' : '刷新'}
      </button>
    </div>
    {query.isPending ? <Loading /> : status?.state !== 'AVAILABLE' ? <>
      <p className="notice" role="status">状态不可确认。请刷新，或核对服务器的状态采集任务。</p>
      <ErrorNotice error={query.error} />
    </> : <>
      <p className="muted">采集时间 {time(status.observedAt, true)}</p>
      {status.alerts.length > 0 && <div className="notice error" role="alert">
        <ul>{status.alerts.map(code => <li key={code}>{alerts[code]}</li>)}</ul>
      </div>}
      <section className="panel">
        <h2>磁盘余量</h2>
        <dl className="server-status-facts">
          <div><dt>可用</dt><dd>{bytes(status.disk.availableBytes)}（{(status.disk.availableBytes * 100 / status.disk.totalBytes).toFixed(1)}%）</dd></div>
          <div><dt>总量</dt><dd>{bytes(status.disk.totalBytes)}</dd></div>
        </dl>
      </section>
      <div className="server-status-backups">
        <BackupDetails title="日常备份" backup={status.daily} />
        <BackupDetails title="发布前备份" backup={status.predeploy} />
      </div>
    </>}
  </div>;
}
