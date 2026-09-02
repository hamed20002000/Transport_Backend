import { HttpException, HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { BaseService } from '../base.service';
import { Works } from 'src/domain/entities/Works';
import { WorkRepository } from 'src/infrastructure/repositories/admin/work.repository';
import { ToolRegister } from '../agent/toolRegister';
import { RequestResult } from '../agent/types';
import { UsernameSpecification } from 'src/application/specifications/user/user-specifications';
import { UserService } from '../user/user.service';
import { ContextManager } from '../agent/contextManager';
import message from '../agent/localFiles/messages.json'
import { TenderService } from './tender.service';
import { CreateWorkDto } from 'src/presentation/dtos/initial-operations/work-dto';
import { recordStatus } from 'src/domain/enums/recordstatus.enum';
import { title } from 'node:process';


@Injectable()
export class WorkService extends BaseService<Works> implements OnModuleInit {
  constructor(

    private readonly workRepository: WorkRepository,
    private readonly toolRtegister: ToolRegister,
    private readonly userService: UserService,
    private readonly history: ContextManager,
    private readonly tenderService: TenderService


  ) {
    super(workRepository);
  }




  onModuleInit() {
    const self = this;
    self.toolRtegister.register({
      functionName: "create_work",
      handler: async function* (param: any): AsyncGenerator<any, RequestResult, any> {

        if (param.title == "" || param.title == null) {
          self.history.addNewHistory({
            status: "fault",
            operation: "create_work",
            parameters: self.history.getParams(param),
            result: {
              errorMessage: message.work.nameisrequired
            }
          }, param.req.user.username, param.sessionId)

          throw new HttpException(message.work.nameisrequired, HttpStatus.BAD_REQUEST);
        }

        if (param.tendername == "" || param.tendername == null) {
          self.history.addNewHistory({
            status: "fault",
            operation: "create_work",
            parameters: self.history.getParams(param),
            result: {
              errorMessage: message.work.tendernameisrequired
            }
          }, param.req.user.username, param.sessionId)

          throw new HttpException(message.work.tendernameisrequired, HttpStatus.BAD_REQUEST);
        }

        if (param.startdate == "" || param.startdate == null) {
          self.history.addNewHistory({
            status: "fault",
            operation: "create_work",
            parameters: self.history.getParams(param),
            result: {
              errorMessage: message.work.startdaterequired
            }
          }, param.req.user.username, param.sessionId)

          throw new HttpException(message.work.startdaterequired, HttpStatus.BAD_REQUEST);
        }

        const user = param.req.user;
        const user_specification = new UsernameSpecification(user.username);

        const [checkUser] = await self.userService.getWithSpecification(
          user_specification,
          null,
          { id: true }
        );


        const workTitle = self.toolRtegister.normalizingName(param.title).trim();
        var tender = (await self.tenderService.getTenderByTitle(workTitle))?.[0]??undefined;
        if(!tender){
            const tenders=await self.tenderService.getAllTenders();
            const tenderId=yield{type:"tenderList",data:tenders.map((item)=>({title:item.title,id:item.id}))}
            tender=await self.tenderService.getById(tenderId)
        }
        const work = new Works();
        work.title = workTitle;
        work.startDate = new Date();
        work.endDate = null;
        work.tender = tender;
        work.createAt = new Date();
        work.recordStatus = recordStatus.Active;
        work.user = checkUser;

        const createdWork = await self.add(work);

        self.history.addNewHistory({
          status: "success",
          operation: "create_work",
          parameters: self.history.getParams(param),
          result: {
            "id": createdWork.id.toString(),
            "title": createdWork.title,
            "startDate": createdWork.startDate.toDateString(),
            "tender": createdWork.tender.title
          }
        }, param.req.user.username, param.sessionId)


        return {
          continuePrompt: undefined,
          toolName: "create_work"
        };
      }
    })


    // self.toolRtegister.register({
    //   functionName: "update_user",
    //   handler: async (param: any): Promise<RequestResult> => {
    //     if (param.username == "" || param.username == null) {
    //       self.history.addNewHistory({
    //         status: "fault",
    //         operation: "update_user",
    //         parameters: self.history.getParams(param),
    //         result: {
    //           errorMessage: message.user.usernamerequired
    //         }
    //       }, param.req.user.username, param.sessionId)
    //       throw new HttpException(message.user.usernamerequired, HttpStatus.BAD_REQUEST);
    //     }
    //     const dto = new UserUpdateDto();
    //     dto.imageSrc = param.files[0];
    //     dto.recordStatus = param.recordStatus;
    //     dto.username = param.newusername;

    //     var user = await self.userRepository.getByUserName(param.username);
    //     if (!user) {
    //       self.history.addNewHistory({
    //         status: "fault",
    //         operation: "update_user",
    //         parameters: self.history.getParams(param),
    //         result: {
    //           errorMessage: message.user.Usernotfound
    //         }
    //       }, param.req.user.username, param.sessionId)

    //       throw new HttpException(message.user.Usernotfound, HttpStatus.NOT_FOUND);
    //     }
    //     user.username = dto.username ?? user.username;
    //     user.imageSrc = dto.imageSrc ?? user.imageSrc;
    //     user.recordStatus = dto.recordStatus ?? user.recordStatus;
    //     var updatedUser = await self.update(user);
    //     var result = GenericMapper.toDto(UserDto, updatedUser, { excludeExtraneousValues: true });

    //     self.history.addNewHistory({
    //       status: "success",
    //       operation: "update_user",
    //       parameters: self.history.getParams(param),
    //       result: {
    //         "id": updatedUser.id.toString(),
    //         "username": updatedUser.username,
    //         "password": updatedUser.password,
    //         "createAt": updatedUser.createAt.toString(),
    //         "recordStatus": updatedUser.recordStatus.toString(),
    //         "roles": updatedUser.roles.join(",")
    //       }
    //     }, param.req.user.username, param.sessionId)

    //     return {
    //       continuePrompt: undefined,
    //       toolName: "update_user"
    //     };
    //   }
    // })


    // self.toolRtegister.register({
    //   functionName: "update_user_record_status",
    //   handler: async (param: any): Promise<RequestResult> => {
    //     if (param.username == "" || param.username == null) {
    //       self.history.addNewHistory({
    //         status: "fault",
    //         operation: "update_user_record_status",
    //         parameters: self.history.getParams(param),
    //         result: {
    //           errorMessage: message.user.usernamerequired
    //         }
    //       }, param.req.user.username, param.sessionId)
    //       throw new HttpException(message.user.usernamerequired, HttpStatus.BAD_REQUEST);
    //     }
    //     const dto = new UserUpdateDto();
    //     dto.recordStatus = param.recordStatus;

    //     var user = await self.userRepository.getByUserName(param.username);
    //     if (!user) {
    //       self.history.addNewHistory({
    //         status: "fault",
    //         operation: "update_user_record_status",
    //         parameters: self.history.getParams(param),
    //         result: {
    //           errorMessage: message.user.Usernotfound
    //         }
    //       }, param.req.user.username, param.sessionId)
    //       throw new HttpException(message.user.Usernotfound, HttpStatus.NOT_FOUND);
    //     }
    //     user.recordStatus = dto.recordStatus ?? user.recordStatus;
    //     var updatedUser = await self.update(user);
    //     var result = GenericMapper.toDto(UserDto, updatedUser, { excludeExtraneousValues: true });

    //     self.history.addNewHistory({
    //       status: "success",
    //       operation: "update_user_record_status",
    //       parameters: self.history.getParams(param),
    //       result: {
    //         "id": updatedUser.id.toString(),
    //         "username": updatedUser.username,
    //         "password": updatedUser.password,
    //         "createAt": updatedUser.createAt.toString(),
    //         "recordStatus": updatedUser.recordStatus.toString(),
    //       }
    //     }, param.req.user.username, param.sessionId)



    //     return {
    //       continuePrompt: undefined,
    //       toolName: "update_user_record_status"
    //     };
    //   }
    // })

    // self.toolRtegister.register({
    //   functionName: "delete_user",
    //   handler: async (param: any): Promise<RequestResult> => {
    //     if (param.username == "" || param.username == null) {
    //       self.history.addNewHistory({
    //         status: "fault",
    //         operation: "update_user",
    //         parameters: self.history.getParams(param),
    //         result: {
    //           errorMessage: message.user.usernamerequired
    //         }
    //       }, param.req.user.username, param.sessionId)
    //       throw new HttpException(message.user.usernamerequired, HttpStatus.BAD_REQUEST);
    //     }
    //     const dto = new UserUpdateDto();

    //     var user = await self.userRepository.getByUserName(param.username);
    //     if (!user) {
    //       self.history.addNewHistory({
    //         status: "fault",
    //         operation: "update_user",
    //         parameters: self.history.getParams(param),
    //         result: {
    //           errorMessage: message.user.Usernotfound
    //         }
    //       }, param.req.user.username, param.sessionId)
    //       throw new HttpException(message.user.Usernotfound, HttpStatus.NOT_FOUND);
    //     }
    //     var updatedUser = await self.deleteUserWithRoles(user.id);
    //     var result = GenericMapper.toDto(UserDto, updatedUser, { excludeExtraneousValues: true });

    //     self.history.addNewHistory({
    //       status: "success",
    //       operation: "delete_user",
    //       parameters: self.history.getParams(param),
    //       result: {
    //         "id": user.id.toString()
    //       }
    //     }, param.req.user.username, param.sessionId)
    //     return {
    //       continuePrompt: undefined,
    //       toolName: "delete_user"
    //     };
    //   }
    // })

    // self.toolRtegister.register({
    //   functionName: "change-user-password",
    //   handler: async (param: any): Promise<RequestResult> => {
    //     if (param.username == "" || param.username == null) {
    //       self.history.addNewHistory({
    //         status: "fault",
    //         operation: "change-user-password",
    //         parameters: self.history.getParams(param),
    //         result: {
    //           errorMessage: message.user.usernamerequired
    //         }
    //       }, param.req.user.username, param.sessionId)
    //       throw new HttpException(message.user.usernamerequired, HttpStatus.BAD_REQUEST);
    //     }
    //     const dto = new changePasswordDto();
    //     dto.username = param.username;
    //     dto.currentPassword = param.currentPassword;
    //     dto.newPassword = param.newPassword;
    //     const specification = new UsernameSpecification(dto.username);
    //     var checkUser = await self.getWithSpecification(specification, null,
    //       { id: true, username: true, password: true });
    //     if (checkUser.length < 1) {

    //       self.history.addNewHistory({
    //         status: "fault",
    //         operation: "change-user-password",
    //         parameters: self.history.getParams(param),
    //         result: {
    //           errorMessage: message.user.Usernotfound
    //         }
    //       }, param.req.user.username, param.sessionId)

    //       throw new HttpException(message.user.Usernotfound, HttpStatus.NOT_FOUND);
    //     }

    //     var checkPass = await self.passwordService.comparePasswords(dto.currentPassword, checkUser[0].password);
    //     if (!checkPass) {
    //       self.history.addNewHistory({
    //         status: "fault",
    //         operation: "change-user-password",
    //         parameters: self.history.getParams(param),
    //         result: {
    //           errorMessage: message.user.passwordisincorrect
    //         }
    //       }, param.req.user.username, param.sessionId)
    //       throw new HttpException(message.user.passwordisincorrect, HttpStatus.BAD_REQUEST);
    //     }
    //     var user = checkUser[0];

    //     user.password = await self.passwordService.hashPassword(dto.newPassword);

    //     var createResult = await self.update(user);

    //     var response_result = GenericMapper.toDto(UserDto, createResult, { excludeExtraneousValues: true });

    //     self.history.addNewHistory({
    //       status: "success",
    //       operation: "change-user-password",
    //       parameters: self.history.getParams(param),
    //       result: {
    //         "id": createResult.id.toString(),
    //         "username": createResult.username,
    //         "password": createResult.password,
    //         "createAt": createResult.createAt.toString(),
    //         "recordStatus": createResult.recordStatus.toString(),
    //         "roles": createResult.roles.join(",")
    //       }
    //     }, param.req.user.username, param.sessionId)

    //     return {
    //       continuePrompt: undefined,
    //       toolName: "change-user-password"
    //     };
    //   }
    // })


    // self.toolRtegister.register({
    //   functionName: "assign-user-roles",
    //   handler: async (param: any): Promise<RequestResult> => {
    //     if (param.username == "" || param.username == null) {
    //       self.history.addNewHistory({
    //         status: "fault",
    //         operation: "assign-user-roles",
    //         parameters: self.history.getParams(param),
    //         result: {
    //           errorMessage: message.user.usernamerequired
    //         }
    //       }, param.req.user.username, param.sessionId)

    //       throw new HttpException(message.user.usernamerequired, HttpStatus.BAD_REQUEST);
    //     }
    //     const dto = new CreateUserRolesDto();


    //     const current_user = param.req.user;
    //     const user_specification = new UsernameSpecification(current_user.username);
    //     const checkUser = await self.getWithSpecification(user_specification, null, { id: true });
    //     if (!checkUser || checkUser.length === 0) {

    //       self.history.addNewHistory({
    //         status: "fault",
    //         operation: "assign-user-roles",
    //         parameters: self.history.getParams(param),
    //         result: {
    //           errorMessage: message.user.Usernotfound
    //         }
    //       }, param.req.user.username, param.sessionId)


    //       throw new HttpException(message.user.Usernotfound, HttpStatus.NOT_FOUND);
    //     }



    //     const user = await self.userRepository.getByUserName(param.username);
    //     if (!user) {
    //       self.history.addNewHistory({
    //         status: "fault",
    //         operation: "assign-user-roles",
    //         parameters: self.history.getParams(param),
    //         result: {
    //           errorMessage: message.user.Usernotfound
    //         }
    //       }, param.req.user.username, param.sessionId)
    //       throw new HttpException(message.user.Usernotfound, HttpStatus.NOT_FOUND);
    //     }


    //     const roles = await self.roleService.getWithSpecification(
    //       new RoleIdsSpecification(dto.roleIds)
    //     );
    //     if (!roles || roles.length !== dto.roleIds.length) {
    //       self.history.addNewHistory({
    //         status: "fault",
    //         operation: "assign-user-roles",
    //         parameters: self.history.getParams(param),
    //         result: {
    //           errorMessage: message.user.Somerolesnotfound
    //         }
    //       }, param.req.user.username, param.sessionId)
    //       throw new HttpException(message.user.Somerolesnotfound, HttpStatus.BAD_REQUEST);
    //     }

    //     // ساخت RoleSystemOperations برای هر operation
    //     const items: UserRoles[] = [];
    //     for (const op of roles) {
    //       const item = new UserRoles();
    //       item.assigendUser = user;
    //       item.role = op;
    //       item.user = checkUser[0];
    //       item.createAt = new Date();
    //       item.recordStatus = recordStatus.Active;
    //       items.push(item);
    //     }


    //     await self.assignRolesToUser(items);

    //     const userWithOperations = await self.getUserWithRoleAndOperations(user.id);

    //     const result = GenericMapper.toDto(UserDto, userWithOperations, { excludeExtraneousValues: true });

    //     self.history.addNewHistory({
    //       status: "success",
    //       operation: "assign-user-roles",
    //       parameters: self.history.getParams(param),
    //       result: {
    //         "id": user.id.toString(),
    //         "roles": items.join(",")
    //       }
    //     }, param.req.user.username, param.sessionId)


    //     return {
    //       continuePrompt: undefined,
    //       toolName: "assign-user-roles"
    //     };
    //   }
    // })




  }

  async getAllWorks(): Promise<Works[]> {
    return this.workRepository.getAllWorks();
  }

  async getWorkById(id: number): Promise<Works> {
    return this.workRepository.getWorkById(id);
  }
}



