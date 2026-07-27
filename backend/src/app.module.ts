import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AiModule } from './ai/ai.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BubblesModule } from './bubbles/bubbles.module';
import { DatabaseModule } from './database/database.module';
import { DiscussionsModule } from './discussions/discussions.module';
import { ProjectsModule } from './projects/projects.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    AiModule,
    DatabaseModule,
    ProjectsModule,
    BubblesModule,
    DiscussionsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
