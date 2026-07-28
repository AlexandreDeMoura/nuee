import { Module } from '@nestjs/common';
import { BubblesModule } from '../bubbles/bubbles.module';
import { ProjectsModule } from '../projects/projects.module';
import { DiscussionContextAssembler } from './discussion-context.assembler';

@Module({
  imports: [ProjectsModule, BubblesModule],
  providers: [DiscussionContextAssembler],
  exports: [DiscussionContextAssembler],
})
export class DiscussionContextModule {}
