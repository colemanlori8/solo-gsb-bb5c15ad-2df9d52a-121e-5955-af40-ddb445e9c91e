import { Project, ReplanResult } from './types';
import { CyclePath } from './SidePanel';

interface ReplanPanelProps {
  project: Project;
  /** 续排试算结果（ok=false 时含成环路径，续排不可用） */
  result: ReplanResult;
  /** 确认后仅更新本次模拟的待执行触发时间 */
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 现场续排预览：以暂停时刻为基准，锁定已完成口令的实际结束与执行中口令的实际起止，
 * 为待执行口令按前置等待、锁定口令的人手占用、班组容量与合并后的休息时段
 * 寻找最早可行空档；先展示新起止与原计划差值，确认后才应用到本次模拟。
 * 图存在环依赖时续排不可用，仅展示成环路径。
 */
export function ReplanPanel(props: ReplanPanelProps) {
  const { project, result } = props;
  const nodeById = new Map(project.nodes.map((n) => [n.id, n]));
  const name = (id: string) => nodeById.get(id)?.name ?? id;

  return (
    <div className="replan-overlay">
      <div className="replan-card">
        <h3>现场续排（基准时刻 t = {round1(result.now)}s）</h3>
        {!result.ok ? (
          <>
            <p className="hint overrun-hint">
              当前口令图存在环依赖，现场续排已禁用；请先解除成环约束。
            </p>
            {result.cycle && <CyclePath project={project} cycle={result.cycle} />}
            <div className="replan-actions">
              <button onClick={props.onCancel}>关闭</button>
            </div>
          </>
        ) : (
          <>
            <p className="hint">
              已锁定：已完成 {result.lockedDoneCount} 条（按实际结束）
              {result.lockedRunning.length > 0 && (
                <>
                  ，执行中 {result.lockedRunning.length} 条（按实际起止：
                  {result.lockedRunning
                    .map((r) => `${name(r.nodeId)} [${round1(r.start)}s, ${round1(r.end)}s)`)
                    .join('、')}
                  ）
                </>
              )}
              ；待执行 {result.items.length} 条参与续排。
            </p>
            {result.items.length === 0 ? (
              <p className="hint">没有待执行的口令，无需续排。</p>
            ) : (
              <table className="crew-table replan-table">
                <thead>
                  <tr>
                    <th>口令</th>
                    <th>原计划起止</th>
                    <th>续排起止</th>
                    <th>开始差值</th>
                  </tr>
                </thead>
                <tbody>
                  {result.items.map((it) => (
                    <tr key={it.nodeId}>
                      <td>{name(it.nodeId)}</td>
                      <td>
                        {round1(it.plannedStart)}s → {round1(it.plannedEnd)}s
                      </td>
                      <td>
                        {round1(it.newStart)}s → {round1(it.newEnd)}s
                      </td>
                      <td>
                        {Math.abs(it.delta) < 1e-9 ? (
                          <span className="delta-zero">不变</span>
                        ) : (
                          <span className={it.delta > 0 ? 'delta-up' : 'delta-down'}>
                            {it.delta > 0 ? '+' : '−'}
                            {round1(Math.abs(it.delta))}s
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="hint">
              续排后预计全部完成于 {round1(result.makespan)}s。
              确认后仅更新本次模拟的待执行触发时间，不写入口令图；重置模拟后失效。
            </p>
            <div className="replan-actions">
              <button className="primary" disabled={result.items.length === 0} onClick={props.onConfirm}>
                确认续排
              </button>
              <button onClick={props.onCancel}>取消</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function round1(v: number): string {
  return (Math.round(v * 10) / 10).toString();
}
