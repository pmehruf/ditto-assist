/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AnyDb } from "../client.js";
import { AnnouncementsRepository } from "./announcementsRepository.js";
import { AnnouncementAcksRepository } from "./announcementAcksRepository.js";
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
import { CategoriesRepository } from "./categoriesRepository.js";
import { PedRepositoryRepository } from "./pedRepositoryRepository.js";
import { PedAliasesRepository } from "./pedAliasesRepository.js";
import { PlanOverridesRepository } from "./planOverridesRepository.js";
import { MappingHistoryRepository } from "./mappingHistoryRepository.js";
import { CollisionsRepository } from "./collisionsRepository.js";
import { QaDashboardConnectionRepository } from "./qaDashboardConnectionRepository.js";
import { QaDashboardRoleRepository } from "./qaDashboardRoleRepository.js";
import { QaEvaluationHistoryRepository } from "./qaEvaluationHistoryRepository.js";
import { KbCategoriesRepository } from "./kbCategoriesRepository.js";
import { KbResourcesRepository } from "./kbResourcesRepository.js";
import { KbChunksRepository } from "./kbChunksRepository.js";
import { KbAnnouncementsRepository } from "./kbAnnouncementsRepository.js";
import { KbChatSessionsRepository } from "./kbChatSessionsRepository.js";
import { KbChatMessagesRepository } from "./kbChatMessagesRepository.js";

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

export { AnnouncementAcksRepository } from "./announcementAcksRepository.js";

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

export { CategoriesRepository } from "./categoriesRepository.js";
export type { CreateCategoryEntry, UpdateCategoryEntry } from "./categoriesRepository.js";

export { PedRepositoryRepository } from "./pedRepositoryRepository.js";
export type { CreatePedEntry, UpdatePedEntry } from "./pedRepositoryRepository.js";

export { PedAliasesRepository } from "./pedAliasesRepository.js";
export type { CreatePedAliasEntry } from "./pedAliasesRepository.js";

export { PlanOverridesRepository } from "./planOverridesRepository.js";
export type { CreatePlanOverrideEntry } from "./planOverridesRepository.js";

export { MappingHistoryRepository } from "./mappingHistoryRepository.js";
export type { CreateMappingHistoryEntry } from "./mappingHistoryRepository.js";

export { CollisionsRepository } from "./collisionsRepository.js";
export type { CollisionType, CreateCollisionEntry } from "./collisionsRepository.js";

export { QaDashboardConnectionRepository } from "./qaDashboardConnectionRepository.js";

export { QaDashboardRoleRepository } from "./qaDashboardRoleRepository.js";
export type { QaDashboardRoleType, UpsertQaDashboardRoleEntry } from "./qaDashboardRoleRepository.js";

export { QaEvaluationHistoryRepository } from "./qaEvaluationHistoryRepository.js";
export type { NewQaEvaluationHistoryEntry } from "./qaEvaluationHistoryRepository.js";

export { KbCategoriesRepository } from "./kbCategoriesRepository.js";
export type { CreateKbCategoryEntry, UpdateKbCategoryEntry } from "./kbCategoriesRepository.js";

export { KbResourcesRepository } from "./kbResourcesRepository.js";
export type {
  CreateKbResourceEntry,
  UpdateKbResourceEntry,
  KbResourceFilter,
} from "./kbResourcesRepository.js";

export { KbChunksRepository } from "./kbChunksRepository.js";
export type { CreateKbChunkEntry, SimilarKbChunk } from "./kbChunksRepository.js";

export { KbAnnouncementsRepository } from "./kbAnnouncementsRepository.js";
export type {
  CreateKbAnnouncementEntry,
  UpdateKbAnnouncementEntry,
} from "./kbAnnouncementsRepository.js";

export { KbChatSessionsRepository } from "./kbChatSessionsRepository.js";
export type { CreateKbChatSessionEntry } from "./kbChatSessionsRepository.js";

export { KbChatMessagesRepository } from "./kbChatMessagesRepository.js";
export type { CreateKbChatMessageEntry } from "./kbChatMessagesRepository.js";

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
  announcementAcks: AnnouncementAcksRepository;
  flaggedIssues: FlaggedIssuesRepository;
  users: UsersRepository;
  externalResources: ExternalResourcesRepository;
  planConfigs: PlanConfigsRepository;
  pedMappingOverrides: PedMappingOverridesRepository;
  pedSuggestions: PedSuggestionsRepository;
  smokeTestPeds: SmokeTestPedsRepository;
  aiMemory: AiMemoryRepository;
  pageVisibility: PageVisibilityRepository;
  categories: CategoriesRepository;
  pedRepository: PedRepositoryRepository;
  pedAliases: PedAliasesRepository;
  planOverrides: PlanOverridesRepository;
  mappingHistory: MappingHistoryRepository;
  collisions: CollisionsRepository;
  qaDashboardConnection: QaDashboardConnectionRepository;
  qaDashboardRoles: QaDashboardRoleRepository;
  qaEvaluationHistory: QaEvaluationHistoryRepository;
  kbCategories: KbCategoriesRepository;
  kbResources: KbResourcesRepository;
  kbChunks: KbChunksRepository;
  kbAnnouncements: KbAnnouncementsRepository;
  kbChatSessions: KbChatSessionsRepository;
  kbChatMessages: KbChatMessagesRepository;
}

export function createRepositories(db: AnyDb): Repositories {
  return {
    searchHistory: new SearchHistoryRepository(db),
    changeLogs: new ChangeLogRepository(db),
    announcements: new AnnouncementsRepository(db),
    announcementAcks: new AnnouncementAcksRepository(db),
    flaggedIssues: new FlaggedIssuesRepository(db),
    users: new UsersRepository(db),
    externalResources: new ExternalResourcesRepository(db),
    planConfigs: new PlanConfigsRepository(db),
    pedMappingOverrides: new PedMappingOverridesRepository(db),
    pedSuggestions: new PedSuggestionsRepository(db),
    smokeTestPeds: new SmokeTestPedsRepository(db),
    aiMemory: new AiMemoryRepository(db),
    pageVisibility: new PageVisibilityRepository(db),
    categories: new CategoriesRepository(db),
    pedRepository: new PedRepositoryRepository(db),
    pedAliases: new PedAliasesRepository(db),
    planOverrides: new PlanOverridesRepository(db),
    mappingHistory: new MappingHistoryRepository(db),
    collisions: new CollisionsRepository(db),
    qaDashboardConnection: new QaDashboardConnectionRepository(db),
    qaDashboardRoles: new QaDashboardRoleRepository(db),
    qaEvaluationHistory: new QaEvaluationHistoryRepository(db),
    kbCategories: new KbCategoriesRepository(db),
    kbResources: new KbResourcesRepository(db),
    kbChunks: new KbChunksRepository(db),
    kbAnnouncements: new KbAnnouncementsRepository(db),
    kbChatSessions: new KbChatSessionsRepository(db),
    kbChatMessages: new KbChatMessagesRepository(db),
  };
}
