import { Module } from '@nestjs/common';
import { DiscussionsModule } from '../discussions/discussions.module';
import { ProjectsModule } from '../projects/projects.module';
import { KnowledgeExtractionService } from './knowledge-extraction.service';
import { KNOWLEDGE_EXTRACTION_REPOSITORY } from './knowledge-extraction.types';
import { SqliteKnowledgeExtractionRepository } from './sqlite-knowledge-extraction.repository';

@Module({
  imports: [ProjectsModule, DiscussionsModule],
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
