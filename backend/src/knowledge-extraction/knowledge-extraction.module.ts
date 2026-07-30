import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { DiscussionsModule } from '../discussions/discussions.module';
import { ProjectsModule } from '../projects/projects.module';
import { KnowledgeExtractionController } from './knowledge-extraction.controller';
import { KnowledgeExtractionService } from './knowledge-extraction.service';
import { KNOWLEDGE_EXTRACTION_REPOSITORY } from './knowledge-extraction.types';
import { SqliteKnowledgeExtractionRepository } from './sqlite-knowledge-extraction.repository';

@Module({
  imports: [AiModule, ProjectsModule, DiscussionsModule],
  controllers: [KnowledgeExtractionController],
  providers: [
    KnowledgeExtractionService,
    SqliteKnowledgeExtractionRepository,
    {
      provide: KNOWLEDGE_EXTRACTION_REPOSITORY,
      useExisting: SqliteKnowledgeExtractionRepository,
    },
  ],
  exports: [KnowledgeExtractionService],
})
export class KnowledgeExtractionModule {}
