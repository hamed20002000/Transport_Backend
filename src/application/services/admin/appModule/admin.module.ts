import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from 'src/auth/auth.module';



import { AgentModule } from 'src/application/services/agent/appModule/agent.module';
import { CondinateService } from '../../agent/services/condinate.service';
import { CancellationService } from '../../agent/services/cancellation.service';


@Module({
    imports: [
        TypeOrmModule.forFeature([ ]),
        forwardRef(() => AuthModule),
        forwardRef(() => AgentModule),
        

    ],
    controllers: [],
    providers: [
            CondinateService,
            CancellationService
    ],
    exports: [
            CondinateService,
            CancellationService
    ]
})
export class AdminModule { } 