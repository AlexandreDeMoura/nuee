import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BubblesModule } from './bubbles/bubbles.module';
import { ProjectsModule } from './projects/projects.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ProjectsModule,
    BubblesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
