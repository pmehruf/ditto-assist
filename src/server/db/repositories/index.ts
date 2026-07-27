/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AnyDb } from "../client.js";
import { AnnouncementsRepository } from "./announcementsRepository.js";
import { ChangeLogRepository } from "./changeLogRepository.js";
import { ExternalResourcesRepository } from "./externalResourcesRepository.js";
import { FlaggedIssuesRepository } from "./flaggedIssuesRepository.js";
import { SearchHistoryRepository } from "./searchHistoryRepository.js";
import { UsersRepository } from "./usersRepository.js";
import { PlanConfigsRepository } from "./planConfigsRepository.js";
import { PedMappingOverridesRepository } from "./pedMappingOverridesRepository.js";
import { PedSuggestionsRepository } from "./pedSuggestionsRepository.js";
import { SmokeTestPedsRepository } from "./smokeTestPedsRepository.js";
import { AiMemoryRepository } from "./aiMemoryRepository.js";
import { PageVisibilityRepository } from "./pageVisibilityRepository.js";

export { SearchHistoryRepository } from "./searchHistoryRepository.js";
export type { SearchHistoryFilter, CreateSearchHistoryEntry } from "./searchHistoryRepository.js";

export { ChangeLogRepository } from "./changeLogRepository.js";
export type { ChangeLogFilter, CreateChangeLogEntry } from "./changeLogRepository.js";

export { AnnouncementsRepository } from "./announcementsRepository.js";
export type {
  AnnouncementFilter,
  CreateAnnouncementEntry,
  UpdateAnnouncementEntry,
} from "./announcementsRepository.js";

export { FlaggedIssuesRepository } from "./flaggedIssuesRepository.js";
export type {
  FlaggedIssueFilter,
  CreateFlaggedIssueEntry,
  UpdateFlaggedIssueEntry,
} from "./flaggedIssuesRepository.js";

export { UsersRepository } from "./usersRepository.js";
export type { CreateUserEntry } from "./usersRepository.js";

export { ExternalResourcesRepository } from "./externalResourcesRepository.js";
export type {
  CreateExternalResourceEntry,
  UpdateExternalResourceEntry,
} from "./externalResourcesRepository.js";

export { PlanConfigsRepository } from "./planConfigsRepository.js";
export type {
  PlanQuestion,
  CreatePlanConfigEntry,
  UpdatePlanConfigEntry,
} from "./planConfigsRepository.js";

export { PedMappingOverridesRepository } from "./pedMappingOverridesRepository.js";

export { PedSuggestionsRepository } from "./pedSuggestionsRepository.js";
export type {
  CreatePedSuggestionEntry,
  UpdatePedSuggestionEntry,
} from "./pedSuggestionsRepository.js";

export { SmokeTestPedsRepository } from "./smokeTestPedsRepository.js";
export type { CreateSmokeTestPedEntry } from "./smokeTestPedsRepository.js";

export { AiMemoryRepository, normalizeCondition } from "./aiMemoryRepository.js";
export type { CreateAiMemoryEntry, AiMemoryStatus } from "./aiMemoryRepository.js";

export { PageVisibilityRepository } from "./pageVisibilityRepository.js";

/**
 * Bundles every repository against a single Db/TestDb instance. This is the
 * intended entry point for API routes (`createRepositories(getDb())`) and
 * for tests (`createRepositories(await createTestDb())`) — nothing outside
 * src/server/db/ should import drizzle-orm or the schema directly.
 */
export interface Repositories {
  searchHistory: SearchHistoryRepository;
  changeLogs: ChangeLogRepository;
  announcements: AnnouncementsRepository;
  flaggedIssues: FlaggedIssuesRepository;
  users: UsersRepository;
  externalResources: ExternalResourcesRepository;
  planConfigs: PlanConfigsRepository;
  pedMappingOverrides: PedMappingOverridesRepository;
  pedSuggestions: PedSuggestionsRepository;
  smokeTestPeds: SmokeTestPedsRepository;
  aiMemory: AiMemoryRepository;
  pageVisibility: PageVisibilityRepository;
}

export function createRepositories(db: AnyDb): Repositories {
  return {
    searchHistory: new SearchHistoryRepository(db),
    changeLogs: new ChangeLogRepository(db),
    announcements: new AnnouncementsRepository(db),
    flaggedIssues: new FlaggedIssuesRepository(db),
    users: new UsersRepository(db),
    externalResources: new ExternalResourcesRepository(db),
    planConfigs: new PlanConfigsRepository(db),
    pedMappingOverrides: new PedMappingOverridesRepository(db),
    pedSuggestions: new PedSuggestionsRepository(db),
    smokeTestPeds: new SmokeTestPedsRepository(db),
    aiMemory: new AiMemoryRepository(db),
    pageVisibility: new PageVisibilityRepository(db),
  };
}
