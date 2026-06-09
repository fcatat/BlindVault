import { useState, useEffect, useCallback } from 'react';
import { useI18n } from '../i18n';
import { 
  listScheduledTasks, 
  pauseScheduledTask, 
  resumeScheduledTask, 
  deleteScheduledTask, 
  getScheduledTaskLogs,
  type ScheduledTask 
} from '../api';
import { 
  CalendarClock, Trash2, Play, Pause, FileText, 
  AlertCircle, CheckCircle2, Clock, XCircle, RefreshCw 
} from 'lucide-react';

interface ScheduledTasksProps {
  sessionId: string;
}

export function ScheduledTasks({ sessionId }: ScheduledTasksProps) {
  const { t, locale } = useI18n();
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // 日志弹窗状态
  const [logTask, setLogTask] = useState<ScheduledTask | null>(null);
  const [logContent, setLogContent] = useState<string>('');
  const [loadingLog, setLoadingLog] = useState(false);

  const isZh = locale === 'zh';

  const loadTasks = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listScheduledTasks(sessionId);
      setTasks(data);
      setError(null);
    } catch (err: any) {
      console.error(err);
      setError(isZh ? '获取定时任务失败，请检查后端服务连通性' : 'Failed to retrieve scheduled tasks, please check backend service connectivity.');
    } finally {
      setLoading(false);
    }
  }, [sessionId, isZh]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  const handleToggleStatus = async (task: ScheduledTask) => {
    try {
      if (task.status === 'active') {
        await pauseScheduledTask(sessionId, task.id);
      } else {
        await resumeScheduledTask(sessionId, task.id);
      }
      loadTasks();
    } catch (err: any) {
      alert(isZh ? `操作失败: ${err.message}` : `Action failed: ${err.message}`);
    }
  };

  const handleDelete = async (taskId: string) => {
    const confirmMsg = isZh ? '确定要删除该定时任务吗？' : 'Are you sure you want to delete this scheduled task?';
    if (!window.confirm(confirmMsg)) return;

    try {
      await deleteScheduledTask(sessionId, taskId);
      setTasks(prev => prev.filter(t => t.id !== taskId));
    } catch (err: any) {
      alert(isZh ? `删除失败: ${err.message}` : `Deletion failed: ${err.message}`);
    }
  };

  const handleViewLogs = async (task: ScheduledTask) => {
    setLogTask(task);
    setLoadingLog(true);
    setLogContent('');
    try {
      const res = await getScheduledTaskLogs(sessionId, task.id);
      setLogContent(res.output || (isZh ? '执行日志为空' : 'Execution log is empty.'));
    } catch (err: any) {
      setLogContent(isZh ? `加载日志失败: ${err.message}` : `Failed to load logs: ${err.message}`);
    } finally {
      setLoadingLog(false);
    }
  };

  // 渲染任务状态徽章
  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return (
          <span className="badge-success inline-flex items-center gap-1">
            <Clock className="w-3 h-3 animate-spin-slow" />
            {isZh ? '调度中' : 'Scheduling'}
          </span>
        );
      case 'paused':
        return (
          <span className="badge-warning inline-flex items-center gap-1">
            <Pause className="w-3 h-3" />
            {isZh ? '已暂停' : 'Paused'}
          </span>
        );
      case 'completed':
        return (
          <span className="badge-success inline-flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            {isZh ? '单次已完成' : 'Completed'}
          </span>
        );
      case 'failed':
        return (
          <span className="badge-danger inline-flex items-center gap-1">
            <XCircle className="w-3 h-3" />
            {isZh ? '单次已失败' : 'Failed'}
          </span>
        );
      default:
        return <span className="badge-neutral">{status}</span>;
    }
  };

  return (
    <div className="flex-1 p-6 max-w-6xl mx-auto overflow-y-auto">
      {/* 头部区域 */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-headline font-bold text-on-surface flex items-center gap-3">
            <CalendarClock className="text-primary w-7 h-7" />
            {isZh ? '计划定时任务' : 'Scheduled Tasks'}
          </h1>
          <p className="text-sm text-on-surface-variant mt-1.5 leading-relaxed">
            {isZh 
              ? '通过 AI 助手在后台安全托管您的周期性或定时延迟运维脚本，命令中所有敏感凭据在运行瞬间自动安全代换。' 
              : 'Safely host your periodic or delayed operations scripts in the background via the AI agent. All sensitive credentials are automatically and securely resolved at runtime.'}
          </p>
        </div>
        <button 
          onClick={loadTasks}
          className="btn-secondary rounded-lg p-2 flex items-center gap-2 text-xs font-semibold"
          disabled={loading}
          title={isZh ? '刷新列表' : 'Refresh list'}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          {isZh ? '刷新' : 'Refresh'}
        </button>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-error-container text-on-error-container rounded-xl flex items-center gap-3 border border-error/20">
          <AlertCircle className="w-5 h-5 shrink-0" />
          <span className="text-sm font-medium">{error}</span>
        </div>
      )}

      {loading && tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-on-surface-variant space-y-3">
          <RefreshCw className="w-8 h-8 animate-spin text-primary" />
          <span className="text-sm font-medium">{isZh ? '加载计划任务中...' : 'Loading scheduled tasks...'}</span>
        </div>
      ) : tasks.length === 0 ? (
        /* Empty State */
        <div className="panel rounded-2xl p-12 text-center max-w-xl mx-auto mt-12 hover:shadow-sm border border-dashed border-outline-variant/60">
          <div className="w-16 h-16 rounded-2xl bg-surface-container-high text-primary flex items-center justify-center mx-auto mb-6">
            <CalendarClock className="w-8 h-8" />
          </div>
          <h3 className="text-base font-semibold text-on-surface mb-2">
            {isZh ? '暂无计划定时任务' : 'No Scheduled Tasks Yet'}
          </h3>
          <p className="text-xs text-on-surface-variant leading-relaxed mb-6 px-4">
            {isZh 
              ? '您可以通过在聊天会话中直接指示 Agent 来创建计划任务。例如：“帮我每10秒向控制台打一次时间”、“帮我每天凌晨2点备份一下数据库”。' 
              : 'You can create scheduled tasks by instructing the Agent in chat. For example: "Help me print the date every 10 seconds" or "Back up the database daily at 2:00 AM".'}
          </p>
        </div>
      ) : (
        /* Grid list */
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {tasks.map(task => (
            <div 
              key={task.id} 
              className={`panel rounded-2xl p-5 flex flex-col justify-between border transition-all duration-300 hover:shadow-md hover:border-outline-variant ${
                task.status === 'paused' ? 'opacity-75 border-outline-variant/40 bg-surface-container-low' : 'border-outline-variant/60'
              }`}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-4 mb-4">
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-on-surface truncate leading-tight mb-1" title={task.label}>
                    {task.label}
                  </h3>
                  <span className="text-[10px] text-on-surface-variant font-mono uppercase tracking-wider block">ID: {task.id}</span>
                </div>
                <div className="shrink-0">
                  {renderStatusBadge(task.status)}
                </div>
              </div>

              {/* Shell Command Code Block */}
              <div className="mb-4">
                <div className="text-[10px] font-bold text-on-surface-variant mb-1 uppercase tracking-wider">{isZh ? '后台执行指令' : 'Command to run'}</div>
                <div className="font-mono bg-surface-container-high text-on-surface text-[11px] p-3 rounded-xl break-all border border-outline-variant/30 leading-relaxed max-h-24 overflow-y-auto">
                  {task.command}
                </div>
              </div>

              {/* Meta information */}
              <div className="grid grid-cols-2 gap-3 text-xs border-t border-outline-variant/30 pt-3 mb-4">
                <div>
                  <span className="text-[10px] text-on-surface-variant block uppercase tracking-wider">{isZh ? '触发规则' : 'Trigger Rule'}</span>
                  <span className="font-medium text-on-surface block mt-0.5 leading-snug">
                    {task.cron_expression 
                      ? `Cron: ${task.cron_expression}` 
                      : task.delay_seconds 
                        ? (isZh ? `延迟 ${task.delay_seconds} 秒` : `Delay ${task.delay_seconds}s`) 
                        : (isZh ? '即时执行' : 'Immediate')}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-on-surface-variant block uppercase tracking-wider">{isZh ? '下次运行时间' : 'Next Execution'}</span>
                  <span className="font-mono text-[11px] text-on-surface block mt-0.5 leading-snug truncate" title={new Date(task.next_run_at).toLocaleString()}>
                    {task.status === 'paused' || task.status === 'completed' || task.status === 'failed'
                      ? '-' 
                      : new Date(task.next_run_at).toLocaleString(locale)}
                  </span>
                </div>
                {task.last_run_at && (
                  <>
                    <div>
                      <span className="text-[10px] text-on-surface-variant block uppercase tracking-wider">{isZh ? '上次运行时间' : 'Last Executed'}</span>
                      <span className="font-mono text-[11px] text-on-surface block mt-0.5 leading-snug truncate">
                        {new Date(task.last_run_at).toLocaleString(locale)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-on-surface-variant block uppercase tracking-wider">{isZh ? '上次运行结果' : 'Last Run Status'}</span>
                      <span className={`font-semibold block mt-0.5 text-xs leading-snug ${task.last_run_status === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                        {task.last_run_status === 'success' 
                          ? (isZh ? '执行成功' : 'SUCCESS') 
                          : (isZh ? '执行失败' : 'FAILED')}
                      </span>
                    </div>
                  </>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex items-center justify-between border-t border-outline-variant/30 pt-3.5">
                <div className="flex items-center gap-2">
                  {/* Status Toggle Switch */}
                  {(task.status === 'active' || task.status === 'paused') && (
                    <button
                      onClick={() => handleToggleStatus(task)}
                      className={`btn flex items-center gap-1.5 py-1.5 px-3 rounded-lg text-xs font-semibold transition-all duration-200 ${
                        task.status === 'active' 
                          ? 'bg-amber-100 hover:bg-amber-200 text-amber-800' 
                          : 'bg-primary/10 hover:bg-primary/20 text-primary'
                      }`}
                    >
                      {task.status === 'active' ? (
                        <>
                          <Pause className="w-3.5 h-3.5" />
                          {isZh ? '暂停' : 'Pause'}
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5" />
                          {isZh ? '启用' : 'Resume'}
                        </>
                      )}
                    </button>
                  )}

                  {/* View Logs Button */}
                  {task.last_run_at && (
                    <button
                      onClick={() => handleViewLogs(task)}
                      className="btn-secondary rounded-lg py-1.5 px-3 flex items-center gap-1.5 text-xs font-semibold"
                    >
                      <FileText className="w-3.5 h-3.5" />
                      {isZh ? '日志' : 'Logs'}
                    </button>
                  )}
                </div>

                {/* Delete button */}
                <button
                  onClick={() => handleDelete(task.id)}
                  className="p-1.5 rounded-lg hover:bg-red-50 text-red-500 hover:text-red-700 transition-colors"
                  title={isZh ? '删除任务' : 'Delete Task'}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Logs Modal Pop-up (Terminal Style) */}
      {logTask && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl border border-outline-variant flex flex-col max-h-[85vh]">
            {/* Modal Header */}
            <div className="p-4 border-b border-outline-variant/60 flex items-center justify-between bg-surface-container-low">
              <div>
                <h3 className="text-sm font-bold text-on-surface flex items-center gap-2">
                  <FileText className="text-primary w-4 h-4" />
                  {isZh ? '任务执行日志控制台' : 'Task Execution Log Console'}
                </h3>
                <p className="text-[10px] text-on-surface-variant font-mono mt-0.5">Task: {logTask.label} ({logTask.id})</p>
              </div>
              <button 
                onClick={() => setLogTask(null)}
                className="text-on-surface-variant hover:text-on-surface p-1 rounded-lg hover:bg-surface-container-high transition-colors text-xs font-bold font-headline"
              >
                ✕
              </button>
            </div>

            {/* Modal Terminal Content */}
            <div className="flex-1 p-5 overflow-y-auto bg-zinc-950 font-mono text-xs text-zinc-100 min-h-64 select-text leading-relaxed">
              {loadingLog ? (
                <div className="flex items-center gap-2 text-zinc-400">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>{isZh ? '正在从云端调取日志...' : 'Fetching logs from cloud...'}</span>
                </div>
              ) : (
                <pre className="whitespace-pre-wrap font-mono break-all">{logContent}</pre>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-3 border-t border-outline-variant/60 flex justify-end bg-surface-container-low">
              <button
                onClick={() => setLogTask(null)}
                className="btn-primary rounded-lg py-1.5 px-4 text-xs font-semibold"
              >
                {isZh ? '关闭' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
