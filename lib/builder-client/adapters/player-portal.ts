/**
 * Type/constant subset for player-portal used by the builder's game-trigger libs.
 * The full player portal is not part of starcaster; see adapters/capabilities.ts.
 */
import type { BuilderTemplateModule } from '../builder-template';
import type { GameAudience } from '../game-audience';

export const PLAYER_POLLS_PER_LEVEL = 10;
export const PLAYER_LEVELS_PER_GRADE = 10;
export const PLAYER_POLLS_PER_GRADE = PLAYER_POLLS_PER_LEVEL * PLAYER_LEVELS_PER_GRADE;

export type PlayerPortalLevelEvent = {
  eventName: string;
  levelName: string;
  sublevelName: string;
  moduleId: string;
  moduleName: string;
  moduleType: string;
  moduleSettings: Record<string, string>;
  gameModule: BuilderTemplateModule | null;
  trigger: string;
  audience: GameAudience;
  metadata: Record<string, unknown>;
};
