export type Obstacle = { x: number; y: number; w: number; h: number };

export const evolutions = [
  {
    id: "doom",
    title: "DOOM - Deterministic Lockstep",
    era: "1993",
    summary: "每帧同步玩家输入，所有节点必须等齐输入再推进。",
    strengths: ["输入包小", "理论一致性强"],
    weaknesses: ["一人卡全员卡", "弱网手感差"]
  },
  {
    id: "quake",
    title: "Quake - Client/Server + Prediction",
    era: "1996",
    summary: "服务器权威模拟，客户端发输入并预测显示。",
    strengths: ["不再全员等待", "支持客户端预测"],
    weaknesses: ["需要纠正跳变", "服务端成本更高"]
  },
  {
    id: "cnc",
    title: "C&C - 工程化 Lockstep",
    era: "1995",
    summary: "仍是 lockstep，但加入队列、ACK、重传、压缩。",
    strengths: ["在旧网络上更稳", "协议工程化增强"],
    weaknesses: ["本质仍锁步", "弱网等待仍明显"]
  },
  {
    id: "source",
    title: "Source - Snapshot State Sync",
    era: "2004+",
    summary: "基线+增量快照、预测、可见性裁剪。",
    strengths: ["规模化能力强", "带宽利用率高"],
    weaknesses: ["实现复杂", "调试门槛高"]
  },
  {
    id: "freefire",
    title: "Free Fire - Hybrid Sync",
    era: "2017+",
    summary: "事件即时通道 + 状态同步并存，按数据语义拆分。",
    strengths: ["适配移动弱网", "兼顾时效与成本"],
    weaknesses: ["系统设计复杂", "跨模块协作要求高"]
  }
];

export const SPAWNS = [
  { x: 220, y: 180 },
  { x: 1700, y: 210 },
  { x: 1850, y: 930 },
  { x: 290, y: 980 },
  { x: 1040, y: 150 },
  { x: 980, y: 1030 }
];

export const OBSTACLES: Obstacle[] = [
  { x: 420, y: 260, w: 240, h: 60 },
  { x: 740, y: 520, w: 340, h: 80 },
  { x: 1250, y: 280, w: 270, h: 70 },
  { x: 1420, y: 730, w: 280, h: 65 },
  { x: 480, y: 820, w: 240, h: 60 }
];

export const COLORS = ["#2f7bd9", "#e06c4e", "#22a67a", "#ab54d1", "#c19434"];
