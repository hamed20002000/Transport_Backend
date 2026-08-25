import { forwardRef, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { BaseService } from '../base.service';
import { SystemOperations } from 'src/domain/entities/SystemOperations';
import { SystemOperationRepository } from 'src/infrastructure/repositories/admin/system-operation.repository';
import { ItemUnits } from 'src/domain/entities/ItemUnits';
import { ItemUnitRepository } from 'src/infrastructure/repositories/admin/item-unit.repository';
import { Items } from 'src/domain/entities/Items';
import { ItemRepository } from 'src/infrastructure/repositories/admin/item.repository';
import { Drivers } from 'src/domain/entities/Drivers';
import { DriversRepository } from 'src/infrastructure/repositories/warehouse/driver.repository';
import { ProjectFirms } from 'src/domain/entities/ProjectFirms';
import { ProjectFirmsRepository } from 'src/infrastructure/repositories/project/project-firm.repository';
import { ForceMajors } from 'src/domain/entities/ForceMajors';
import { ForceMajorsRepository } from 'src/infrastructure/repositories/project/force-major.repository';
import { ToolRegister } from '../agent/toolRegister';
import { UserService } from '../user/user.service';
import { RequestResult } from '../agent/types';
import { ContextManager } from '../agent/contextManager';
import messages from '../agent/localFiles/messages.json';
import { UsernameSpecification } from 'src/application/specifications/user/user-specifications';
import { GenericMapper } from 'src/presentation/helpers/mapper-classes';
import { recordStatus } from 'src/domain/enums/recordstatus.enum';
import { CreateForceMajorDto } from 'src/presentation/dtos/project/forceMajor-dto';


@Injectable()
export class ForceMajorService extends BaseService<ForceMajors> {
  constructor(

    private readonly forceMajorsRepository: ForceMajorsRepository,
    private readonly toolRegister: ToolRegister,
    @Inject(forwardRef(() => UserService))
    private readonly userService: UserService,
    private readonly history: ContextManager,

  ) {
    super(forceMajorsRepository);
  }

  onModuleInit() {
    this.toolRegister.register({
      functionName: "create_force_major",
      handler: async (param: any): Promise<RequestResult> => {

        if (param.title == undefined || param.title.replaceAll(" ", "") == "") {
          this.history.addNewHistory({
            status: "fault",
            operation: "create_force_major",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.forceMajor.nameisrequired
            }
          }, param.req.user.username,param.sessionId)
          throw new HttpException(messages.forceMajor.nameisrequired, HttpStatus.BAD_REQUEST);
        }


        const user = param.req.user;
        const user_specification = new UsernameSpecification(user.username);

        const [checkUser] = await this.userService.getWithSpecification(
          user_specification,
          null,
          { id: true }
        );

        const forceMajorDto = new CreateForceMajorDto();
        forceMajorDto.title = param.title;

        var forceMajor = GenericMapper.toEntity(ForceMajors, forceMajorDto);
        forceMajor.createAt = new Date();
        forceMajor.recordStatus = recordStatus.Active;
        forceMajor.user = checkUser[0];

        var createForceMajor = await this.add(forceMajor);

        this.history.addNewHistory({
          status: "success",
          operation: "create_force_major",
          parameters: this.history.getParams(param),
          result: {
            "id": forceMajor.id.toString(),
            "title": forceMajor.title,
            "recordstatus": forceMajor.recordStatus.toString(),
          }
        }, param.req.user.username,param.sessionId)

        return {
          continuePrompt: undefined,
          toolName: "create_force_major"
        }



      }
    })

    this.toolRegister.register({
      functionName: "update_force_major",
      handler: async (param: any): Promise<RequestResult> => {
        if (param.title == undefined || param.title.replaceAll(" ", "") == "") {
          this.history.addNewHistory({
            status: "fault",
            operation: "update_force_major",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.supplier.nameisrequired
            }
          }, param.req.user.username,param.sessionId)

          throw new HttpException(messages.supplier.nameisrequired, HttpStatus.BAD_REQUEST);
        }
        const forceMajorname = this.toolRegister.normalizingName(param.title).trim();
        const forceMajornewname = this.toolRegister.normalizingName(param.newtitle).trim();
        var checkForceMajor = await this.forceMajorsRepository.findByName(forceMajorname);

        if (!checkForceMajor) {
          this.history.addNewHistory({
            status: "fault",
            operation: "update_force_major",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.forceMajor.notfound
            }
          }, param.req.user.username,param.sessionId)

          throw new HttpException(messages.forceMajor.notfound, HttpStatus.NOT_FOUND);
        }
        checkForceMajor.title = forceMajornewname ?? checkForceMajor.title;


        var updateForceMajor = await this.update(checkForceMajor);

        this.history.addNewHistory({
          status: "success",
          operation: "update_force_major",
          parameters: this.history.getParams(param),
          result: {
            "id": updateForceMajor.id.toString(),
            "title": updateForceMajor.title,
          }
        }, param.req.user.username,param.sessionId)

        return {
          continuePrompt: undefined,
          toolName: "update_force_major"
        }
      }
    })

    this.toolRegister.register({
      functionName: "delete_force_major",
      handler: async (param: any): Promise<RequestResult> => {

        if (param.title == undefined || param.title.replaceAll(" ", "") == "") {
          this.history.addNewHistory({
            status: "fault",
            operation: "delete_force_major",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.forceMajor.nameisrequired
            }
          }, param.req.user.username,param.sessionId)
          throw new HttpException(messages.forceMajor.nameisrequired, HttpStatus.BAD_REQUEST);
        }

        const deleteForcemajorName = this.toolRegister.normalizingName(param.title);

        var deleteSupplier = await this.forceMajorsRepository.findByName(deleteForcemajorName.trim());
        if (deleteSupplier == null) {
          this.history.addNewHistory({
            status: "fault",
            operation: "delete_force_major",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.forceMajor.notfound
            }
          }, param.req.user.username,param.sessionId)
          throw new HttpException(messages.forceMajor.notfound, HttpStatus.BAD_REQUEST);
        }

        var deleteProduct = await this.delete(deleteSupplier.id);
        this.history.addNewHistory({
          status: "success",
          operation: "delete_force_major",
          parameters: this.history.getParams(param),
          result: {
            "id": deleteSupplier.id.toString(),
            "title": deleteForcemajorName,
          }
        }, param.req.user.username,param.sessionId)


        return {
          continuePrompt: undefined,
          toolName: "delete_force_major"
        };
      }
    })

    this.toolRegister.register({
      functionName: "update_force_major_record_status",
      handler: async (param: any): Promise<RequestResult> => {
        if (param.title == undefined || param.title.replaceAll(" ", "") == "") {
          this.history.addNewHistory({
            status: "fault",
            operation: "update_force_major",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.supplier.nameisrequired
            }
          }, param.req.user.username,param.sessionId)

          throw new HttpException(messages.supplier.nameisrequired, HttpStatus.BAD_REQUEST);
        }
        const forceMajorname = this.toolRegister.normalizingName(param.title).trim();
        var checkForceMajor = await this.forceMajorsRepository.findByName(forceMajorname);

        if (!checkForceMajor) {
          this.history.addNewHistory({
            status: "fault",
            operation: "update_force_major_record_status",
            parameters: this.history.getParams(param),
            result: {
              errorMessage: messages.forceMajor.notfound
            }
          }, param.req.user.username,param.sessionId)

          throw new HttpException(messages.forceMajor.notfound, HttpStatus.NOT_FOUND);
        }
        checkForceMajor.recordStatus = param.recordstatus ?? checkForceMajor.recordStatus;


        var updateForceMajor = await this.update(checkForceMajor);

        this.history.addNewHistory({
          status: "success",
          operation: "update_force_major_record_status",
          parameters: this.history.getParams(param),
          result: {
            "id": updateForceMajor.id.toString(),
            "title": updateForceMajor.title,
          }
        }, param.req.user.username,param.sessionId)

        return {
          continuePrompt: undefined,
          toolName: "update_force_major_record_status"
        }
      }
    })


  }



}