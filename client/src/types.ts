export interface CommandNode {
  id: string;
  name: string;
  /** 口令执行持续时长（秒） */
  duration: number;
  /** 执行该口令占用的班组人数（非负整数；缺省为 0，兼容旧数据） */
  crew?: number;
  x: number;
  y: number;
}

export interface CommandEdge {
  id: string;
  /** 前置口令 */
  from: string;
  /** 后继口令 */
  to: string;
  /** 前置完成后至少等待的秒数 */
  minDelay: number;
}

/** 开场截止设置（相对排程零点的秒数） */
export interface DeadlineSetting {
  enabled: boolean;
  seconds: number;
}

/** 休息时段：相对排程零点的半开区间 [start, end)（秒），时段内班组容量为零 */
export interface BreakPeriod {
  id: string;
  /** 起点秒数（有限数，≥ 0 且小于终点） */
  start: number;
  /** 终点秒数（有限数，大于起点） */
  end: number;
}

export interface Project {
  nodes: CommandNode[];
  edges: CommandEdge[];
  /** 开场截止设置；缺省表示未配置（兼容旧数据） */
  deadline?: DeadlineSetting;
  /** 班组总人数（正整数；缺省为 1，兼容旧数据） */
  crewSize?: number;
  /** 休息时段列表；缺省为空（兼容旧数据），仅影响班组排程 */
  breaks?: BreakPeriod[];
}

export interface CycleInfo {
  /** 成环路径上的节点 id（按环顺序） */
  nodeIds: string[];
  /** 成环路径上的边 id（按环顺序） */
  edgeIds: string[];
}

/** 截止倒排结果：按全部后继约束反向计算的最晚开始与浮动 */
export interface BackwardInfo {
  /** 本次倒排使用的截止秒数 */
  deadline: number;
  /** 每个口令的最晚开始时间（秒） */
  latestStarts: Record<string, number>;
  /** 每个口令的浮动时间（最晚开始 - 最早开始；超期时为负） */
  floats: Record<string, number>;
  /** 关键链上的节点 id（浮动最小，正常排程下即浮动为 0） */
  criticalNodeIds: string[];
  /** 关键链上的约束边 id */
  criticalEdgeIds: string[];
  /** 截止时间早于最短工期时的超期秒数（未超期为 0） */
  overrun: number;
}

export interface ScheduleResult {
  ok: boolean;
  /** 每个口令的最早开始时间（秒，相对排程零点） */
  starts: Record<string, number>;
  /** 全部口令完成的总时长（秒） */
  makespan: number;
  cycle?: CycleInfo;
  /** 启用截止时间且图无环时的倒排结果 */
  backward?: BackwardInfo;
}

/** 班组排程中一条口令的排定结果 */
export interface CrewAssignment {
  nodeId: string;
  /** 排定开始时间（秒，相对排程零点） */
  start: number;
  /** 排定结束时间（秒）；占用按 [start, end) 计算 */
  end: number;
}

/** 班组排程结果：容量约束下的不抢占可行排程 */
export interface CrewScheduleResult {
  ok: boolean;
  /** 按排定先后列出的口令起止 */
  assignments: CrewAssignment[];
  /** 每个口令的排定开始时间（秒） */
  starts: Record<string, number>;
  /** 全部口令完成的总时长（秒） */
  makespan: number;
  /** 交叠或相邻休息时段合并后的半开零容量区间（升序、互不交叠） */
  mergedBreaks: Array<{ start: number; end: number }>;
  cycle?: CycleInfo;
}

/** 现场续排：一条待执行口令的新旧计划对比 */
export interface ReplanItem {
  nodeId: string;
  /** 原计划开始/结束（秒，当前模拟正在使用的触发计划） */
  plannedStart: number;
  plannedEnd: number;
  /** 续排后的开始/结束（秒） */
  newStart: number;
  newEnd: number;
  /** 新开始 - 原计划开始（秒；负值表示提前） */
  delta: number;
}

/**
 * 现场续排结果：暂停时以当前模拟时刻为基准，
 * 锁定已完成口令的实际结束与执行中口令的实际起止，
 * 为待执行口令在容量与休息时段约束下寻找最早可行空档。
 */
export interface ReplanResult {
  ok: boolean;
  /** 续排基准时刻（暂停时的模拟时刻，秒） */
  now: number;
  /** 待执行口令的新旧计划对比（按新开始时刻升序） */
  items: ReplanItem[];
  /** 锁定的执行中口令（实际起止，占用人手计入续排） */
  lockedRunning: { nodeId: string; start: number; end: number }[];
  /** 锁定的已完成口令数量（按实际结束锁定） */
  lockedDoneCount: number;
  /** 续排后全部口令（含锁定）的完成时刻 */
  makespan: number;
  /** 图存在环依赖时的成环路径（此时 ok=false，续排不可用） */
  cycle?: CycleInfo;
}

export type SimState = 'idle' | 'running' | 'paused' | 'finished';

export type NodeStatus = 'pending' | 'running' | 'done';

export interface NodeRuntime {
  status: NodeStatus;
  /** 实际开始时间（秒） */
  start?: number;
  /** 实际/预计结束时间（秒） */
  end?: number;
}
