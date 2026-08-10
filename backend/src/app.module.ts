import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiModule } from './ai/ai.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BubblesModule } from './bubbles/bubbles.module';
import {
  aiConfig,
  appConfig,
  documentsConfig,
  validateEnvironment,
} from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { DiscussionsModule } from './discussions/discussions.module';
import { DocumentsModule } from './documents/documents.module';
import { KnowledgeExtractionModule } from './knowledge-extraction/knowledge-extraction.module';
import { ProjectsModule } from './projects/projects.module';
import { TerritoriesModule } from './territories/territories.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [appConfig, aiConfig, documentsConfig],
      validate: validateEnvironment,
    }),
    AiModule,
    DatabaseModule,
    ProjectsModule,
    TerritoriesModule,
    BubblesModule,
    DocumentsModule,
    DiscussionsModule,
    KnowledgeExtractionModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
