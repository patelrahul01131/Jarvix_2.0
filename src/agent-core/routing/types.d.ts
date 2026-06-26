/**
 * Intent Router Type Definitions
 */

export interface IntentClassification {
  intent: string;
  execution_mode: 'agent' | 'chat' | 'fast_path' | 'memory' | 'system';
  complexity: number;
  task_scale: 'micro' | 'small' | 'large';
  risk_level: 'low' | 'medium' | 'high';
  needs_rag: boolean;
  needs_terminal: boolean;
  context_expansion_needed: boolean;
  requires_context: boolean;
  requires_planning: boolean;
  requires_tools: boolean;
  requires_memory: boolean;
  requires_web: boolean;
  requires_reflection: boolean;
  estimated_files: number;
}

export interface RouteResult {
  primaryIntent: IntentClassification;
  confidence: number;
  isDecomposed: boolean;
  subTasks?: IntentClassification[];
  matchedExample?: string;
  source: 'semantic' | 'llm' | 'heuristic' | 'context';
}

export interface ConfidenceThresholds {
  IMMEDIATE_ROUTE: number; // e.g. 0.90
  VERIFY_ROUTE: number;    // e.g. 0.70
  LLM_ARBITRATION: number; // e.g. 0.40
}

export interface SemanticExample {
  id: string;
  text: string;
  intent: string;
  vector?: number[];
}
