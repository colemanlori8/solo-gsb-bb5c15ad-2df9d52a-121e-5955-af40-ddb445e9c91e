import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadProject, saveProject } from './api';
import { CrewPanel } from './CrewPanel';
import { GraphCanvas, Selection } from './GraphCanvas';
import { ReplanPanel } from './ReplanPanel';
import { computeCrewSchedule, computeLiveReplan, computeSchedule } from './schedule';
import { SidePanel } from './SidePanel';
import { Timeline } from './Timeline';
import { BreakPeriod, CommandNode, Project, ReplanResult, ScheduleResult } from './types';
import { useSimulation } from './useSimulation';

const EMPTY: Project = { nodes: [], edges: [] };

/** 兼容旧数据：班组人数缺省 1（正整数），口令用人数缺省 0（不超过班组人数的非负整数），休息时段缺省空。 */
function normalizeProject(p: Project): Project {
  const raw = p.crewSize;
  const crewSize =
    typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 ? raw : 1;
  // 休息时段仅保留两端为有限数且 0≤起点<终点 的项（旧项目缺省为空）
  const breaks: BreakPeriod[] = Array.isArray(p.breaks)
    ? p.breaks
        .filter(
          (b): b is BreakPeriod =>
            !!b &&
            typeof b.start === 'number' &&
            typeof b.end === 'number' &&
            Number.isFinite(b.start) &&
            Number.isFinite(b.end) &&
            b.start >= 0 &&
            b.start < b.end,
        )
        .map((b, i) => ({
          id: typeof b.id === 'string' && b.id ? b.id : `break-${i}-${crypto.randomUUID()}`,
          start: b.start,
          end: b.end,
        }))
    : [];
  return {
    ...p,
    crewSize,
    breaks,
    nodes: p.nodes.map((n) => {
      const c = n.crew;
      const crew =
        typeof c === 'number' && Number.isInteger(c) && c >= 0 ? Math.min(c, crewSize) : 0;
      return { ...n, crew };
    }),
  };
}

export default function App() {
  const [project, setProject] = useState<Project | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [selection, setSelection] = useState<Selection | null>(null);

  // 初始加载
  useEffect(() => {
    loadProject()
      .then((p) => setProject(normalizeProject(p)))
      .catch((e) => setLoadError(String(e?.message ?? e)));
  }, []);

  // 实时重算最早执行时间
  const schedule: ScheduleResult | null = useMemo(
    () => (project ? computeSchedule(project) : null),
    [project],
  );

  // 班组排程随编辑实时重算（有环时仅保留成环路径）
  const crewSchedule = useMemo(
    () => (project ? computeCrewSchedule(project) : null),
    [project],
  );

  // 出现环依赖时保留上次有效排程
  const [lastValid, setLastValid] = useState<ScheduleResult | null>(null);
  useEffect(() => {
    if (schedule?.ok) setLastValid(schedule);
  }, [schedule]);
  const effectiveSchedule = schedule?.ok ? schedule : lastValid;
  const cycle = schedule && !schedule.ok ? schedule.cycle : undefined;

  const sim = useSimulation(project ?? EMPTY, effectiveSchedule);

  // 现场续排预览（仅暂停时打开；纯内存试算，确认前不影响任何状态）
  const [replanPreview, setReplanPreview] = useState<ReplanResult | null>(null);

  // 当前模拟正在使用的触发计划：续排覆盖优先，其次为生效排程
  const plannedStarts = useMemo(() => {
    const starts: Record<string, number> = {};
    if (project && effectiveSchedule) {
      for (const n of project.nodes) {
        starts[n.id] = sim.overrides?.[n.id] ?? effectiveSchedule.starts[n.id] ?? 0;
      }
    }
    return starts;
  }, [project, effectiveSchedule, sim.overrides]);

  // 离开暂停状态时关闭预览；预览打开期间口令图 / 运行状态变化时按同一基准时刻重算
  useEffect(() => {
    if (sim.state !== 'paused') {
      setReplanPreview(null);
      return;
    }
    setReplanPreview((prev) =>
      prev && project ? computeLiveReplan(project, sim.runtime, sim.time, plannedStarts) : prev,
    );
  }, [sim.state, project, sim.runtime, sim.time, plannedStarts]);

  const openReplan = useCallback(() => {
    if (sim.state !== 'paused' || !project) return;
    setReplanPreview(computeLiveReplan(project, sim.runtime, sim.time, plannedStarts));
  }, [sim.state, sim.runtime, sim.time, project, plannedStarts]);

  // 确认续排：仅更新本次模拟的待执行触发时间，不写入口令图
  const confirmReplan = useCallback(() => {
    if (!replanPreview?.ok) return;
    const starts: Record<string, number> = {};
    for (const it of replanPreview.items) starts[it.nodeId] = it.newStart;
    sim.applyReplan(starts);
    setReplanPreview(null);
  }, [replanPreview, sim]);

  const cancelReplan = useCallback(() => setReplanPreview(null), []);

  // 本地持久化（防抖）
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persist = useCallback((p: Project) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState('saving');
    saveTimer.current = setTimeout(() => {
      saveProject(p)
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('error'));
    }, 400);
  }, []);

  const update = useCallback(
    (fn: (p: Project) => Project) => {
      setProject((prev) => {
        if (!prev) return prev;
        const next = fn(prev);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const addNode = useCallback(() => {
    const id = crypto.randomUUID();
    update((p) => ({
      ...p,
      nodes: [
        ...p.nodes,
        { id, name: `口令${p.nodes.length + 1}`, duration: 3, crew: 0, x: 120 + p.nodes.length * 30, y: 120 + p.nodes.length * 24 },
      ],
    }));
    setSelection({ type: 'node', id });
  }, [update]);

  const moveNode = useCallback(
    (id: string, x: number, y: number) => {
      update((p) => ({ ...p, nodes: p.nodes.map((n) => (n.id === id ? { ...n, x, y } : n)) }));
    },
    [update],
  );

  const updateNode = useCallback(
    (id: string, patch: Partial<Pick<CommandNode, 'name' | 'duration' | 'crew'>>) => {
      update((p) => ({ ...p, nodes: p.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
    },
    [update],
  );

  const deleteNode = useCallback(
    (id: string) => {
      update((p) => ({
        nodes: p.nodes.filter((n) => n.id !== id),
        edges: p.edges.filter((e) => e.from !== id && e.to !== id),
      }));
      setSelection(null);
    },
    [update],
  );

  const addEdge = useCallback(
    (from: string, to: string) => {
      update((p) => {
        if (p.edges.some((e) => e.from === from && e.to === to)) return p;
        return { ...p, edges: [...p.edges, { id: crypto.randomUUID(), from, to, minDelay: 0 }] };
      });
    },
    [update],
  );

  const updateEdge = useCallback(
    (id: string, patch: { minDelay?: number }) => {
      update((p) => ({ ...p, edges: p.edges.map((e) => (e.id === id ? { ...e, ...patch } : e)) }));
    },
    [update],
  );

  const deleteEdge = useCallback(
    (id: string) => {
      update((p) => ({ ...p, edges: p.edges.filter((e) => e.id !== id) }));
      setSelection(null);
    },
    [update],
  );

  const setDeadlineEnabled = useCallback(
    (enabled: boolean) => {
      update((p) => ({
        ...p,
        deadline: {
          enabled,
          // 首次启用时默认取当前最短工期，便于直接看到关键链
          seconds: p.deadline?.seconds ?? Math.ceil(effectiveSchedule?.makespan ?? 30),
        },
      }));
    },
    [update, effectiveSchedule],
  );

  const setDeadlineSeconds = useCallback(
    (seconds: number) => {
      update((p) => ({ ...p, deadline: { enabled: p.deadline?.enabled ?? true, seconds } }));
    },
    [update],
  );

  // 班组人数为正整数；下调时同步压减各口令用人数，保持“用人数 ≤ 班组人数”
  const setCrewSize = useCallback(
    (crewSize: number) => {
      update((p) => ({
        ...p,
        crewSize,
        nodes: p.nodes.map((n) => ({ ...n, crew: Math.min(n.crew ?? 0, crewSize) })),
      }));
    },
    [update],
  );

  const addBreak = useCallback(() => {
    update((p) => ({
      ...p,
      breaks: [...(p.breaks ?? []), { id: crypto.randomUUID(), start: 0, end: 1 }],
    }));
  }, [update]);

  const updateBreak = useCallback(
    (id: string, patch: Partial<Pick<BreakPeriod, 'start' | 'end'>>) => {
      update((p) => ({
        ...p,
        breaks: (p.breaks ?? []).map((b) => (b.id === id ? { ...b, ...patch } : b)),
      }));
    },
    [update],
  );

  const deleteBreak = useCallback(
    (id: string) => {
      update((p) => ({ ...p, breaks: (p.breaks ?? []).filter((b) => b.id !== id) }));
    },
    [update],
  );

  if (loadError) {
    return <div className="boot-message">加载失败：{loadError}</div>;
  }
  if (!project) {
    return <div className="boot-message">正在加载口令沙盘…</div>;
  }

  const simActive = sim.state === 'running' || sim.state === 'paused';
  const canStart = project.nodes.length > 0 && sim.state !== 'running' && sim.state !== 'paused';
  const deadline = project.deadline;
  const backward = effectiveSchedule?.backward;

  return (
    <div className="app">
      <header className="toolbar">
        <h1>舞台换景口令沙盘</h1>
        <button onClick={addNode}>＋ 添加口令</button>
        <span className="sep" />
        {sim.state === 'idle' || sim.state === 'finished' ? (
          <button className="primary" disabled={!canStart} onClick={sim.start}>
            ▶ 开始模拟
          </button>
        ) : sim.state === 'running' ? (
          <button className="primary" onClick={sim.pause}>⏸ 暂停</button>
        ) : (
          <button className="primary" onClick={sim.resume}>⏵ 继续</button>
        )}
        <button disabled={sim.state === 'idle'} onClick={sim.reset}>⟲ 重置</button>
        <button
          disabled={sim.state !== 'paused'}
          title={cycle ? '暂停时可试算现场续排；当前存在环依赖，打开后仅显示成环路径' : '暂停时以当前时刻为基准，为待执行口令重排最早可行计划'}
          onClick={openReplan}
        >
          ⇄ 现场续排
        </button>
        <span className="sim-clock">
          {sim.state !== 'idle' && `t = ${sim.time.toFixed(1)}s`}
          {sim.state === 'finished' && ' · 全部完成'}
          {sim.overrides && sim.state !== 'idle' && ' · 已续排'}
        </span>
        <span className="sep" />
        <label className="deadline-toggle" title="按全部后继约束反向计算最晚开始与浮动">
          <input
            type="checkbox"
            checked={deadline?.enabled ?? false}
            onChange={(e) => setDeadlineEnabled(e.target.checked)}
          />
          开场截止
        </label>
        {deadline?.enabled && (
          <span className="deadline-ctrl">
            <input
              type="number"
              min={0}
              step={0.5}
              value={deadline.seconds}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v) && v >= 0) setDeadlineSeconds(v);
              }}
            />
            <span className="deadline-unit">s</span>
            {backward && backward.overrun > 0 && (
              <span className="overrun">超期 {round1(backward.overrun)}s</span>
            )}
          </span>
        )}
        <span className="sep" />
        <label className="crew-ctrl" title="班组总人数（正整数）；班组排程中同一时刻总用人数不超过该值">
          班组人数
          <input
            type="number"
            min={1}
            step={1}
            value={project.crewSize ?? 1}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isInteger(v) && v >= 1) setCrewSize(v);
            }}
          />
          <span className="deadline-unit">人</span>
        </label>
        <span className="spacer" />
        <span className={`save-state ${saveState}`}>
          {saveState === 'saved' ? '已保存' : saveState === 'saving' ? '保存中…' : '保存失败'}
        </span>
      </header>

      {cycle && (
        <div className="cycle-banner">
          ⚠ 检测到环依赖（{cycle.nodeIds.length} 条口令成环），已保留上次有效排程；成环路径已红色高亮。
        </div>
      )}

      <div className="main">
        <div className="canvas-wrap">
          <GraphCanvas
            project={project}
            schedule={effectiveSchedule}
            cycle={cycle}
            runtime={sim.runtime}
            selection={selection}
            onSelect={setSelection}
            onMoveNode={moveNode}
            onAddEdge={addEdge}
          />
          {replanPreview && (
            <ReplanPanel
              project={project}
              result={replanPreview}
              onConfirm={confirmReplan}
              onCancel={cancelReplan}
            />
          )}
        </div>
        <SidePanel
          project={project}
          schedule={effectiveSchedule}
          selection={selection}
          cycle={cycle}
          crewSize={project.crewSize ?? 1}
          onUpdateNode={updateNode}
          onUpdateEdge={updateEdge}
          onDeleteNode={deleteNode}
          onDeleteEdge={deleteEdge}
        />
      </div>

      <CrewPanel
        project={project}
        result={crewSchedule}
        cycle={cycle}
        onAddBreak={addBreak}
        onUpdateBreak={updateBreak}
        onDeleteBreak={deleteBreak}
      />

      <Timeline
        project={project}
        schedule={effectiveSchedule}
        cycle={cycle}
        runtime={sim.runtime}
        simTime={sim.time}
        simActive={simActive || sim.state === 'finished'}
        replanStarts={sim.overrides}
      />
    </div>
  );
}

function round1(v: number): string {
  return (Math.round(v * 10) / 10).toString();
}
