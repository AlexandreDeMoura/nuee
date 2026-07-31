import { Module } from '@nestjs/common';
import { BubblesModule } from '../bubbles/bubbles.module';
import { DocumentsModule } from '../documents/documents.module';
import { ProjectsModule } from '../projects/projects.module';
import { DiscussionContextAssembler } from './discussion-context.assembler';

@Module({
  imports: [ProjectsModule, BubblesModule, DocumentsModule],
  providers: [DiscussionContextAssembler],
  exports: [DiscussionContextAssembler],
})
export class DiscussionContextModule {}
