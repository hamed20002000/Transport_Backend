import { BadRequestException, HttpException, HttpStatus, Injectable, Inject, forwardRef } from '@nestjs/common';



import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';

import { BaseService } from '../base.service';
import { UserRepository } from 'src/infrastructure/repositories/user/user.repository';
import { Users } from 'src/domain/entities/Users';
import { Roles } from 'src/domain/entities/Roles';
import { RoleRepository } from 'src/infrastructure/repositories/user/role.repository';
import { RoleIdsSpecification, RoleNamesSpecification, RoleSpecification } from 'src/application/specifications/user/role-specifications';


import { CreateUserRolesDto, ForgotPasswordDto, ResetPasswordDto, UserDto, UserUpdateDto } from 'src/presentation/dtos/user/user.dto';
import { UsernameSpecification } from 'src/application/specifications/user/user-specifications';
import { EmailService } from '../helper/email-service';
import { use } from 'passport';
import { PasswordService } from '../helper/password.service';


import { FindOptionsRelations } from 'typeorm';


import { UserRoles } from 'src/domain/entities/UserRoles';
import { UserRoleRepository } from 'src/infrastructure/repositories/user/user-role.repository';
import { UserMenuOperationRepository } from 'src/infrastructure/repositories/user/user-menu-operation.repository';
import { UserMenuOperations } from 'src/domain/entities/UserMenuOperations';
import { changePasswordDto, registerUserDto } from 'src/presentation/dtos/user/register-user.dto';
import { MenuOperationService } from '../admin/menu-operation.service';
import { ToolRegister } from '../agent/toolRegister';
import { GenericMapper } from 'src/presentation/helpers/mapper-classes';
import { recordStatus } from 'src/domain/enums/recordstatus.enum';
import { RoleService } from './role.service';
import message from '../agent/localFiles/messages.json'
import { RequestResult } from '../agent/types';
import { ContextManager } from '../agent/contextManager';


@Injectable()
export class UserService extends BaseService<Users> {
  constructor(

    private readonly userRepository: UserRepository,
    private readonly userMenuOperationsRepository: UserMenuOperationRepository,
    private readonly userRoleRepository: UserRoleRepository,
    private readonly passwordService: PasswordService,
    private readonly toolRtegister: ToolRegister,
    private readonly roleService: RoleService,
    private readonly history:ContextManager
    

  ) {
    super(userRepository);
  }

  onModuleInit() {

    this.toolRtegister.register({
      functionName: "create_user",
      handler: async (param: any): Promise<RequestResult> => {
        const createUserDto = new registerUserDto();

        if (param.username == "" || param.username == null) {
                    this.history.addNewHistory({
            status:"fault",
            operation:"create_user",
            parameters:this.history.getParams(param),
            result:{
              errorMessage:message.user.usernamerequired
            }
          },param.req.user.username)

          throw new HttpException(message.user.usernamerequired, HttpStatus.BAD_REQUEST);
        }
        if (param.password == "" || param.password == null) {
           this.history.addNewHistory({
            status:"fault",
            operation:"create_user",
            parameters:this.history.getParams(param),
            result:{
              errorMessage:message.user.passwordrequired
            }
          },param.req.user.username)
          throw new HttpException(message.user.passwordrequired, HttpStatus.BAD_REQUEST);
        }
        createUserDto.username = param.username;
        createUserDto.password = param.password;
        createUserDto.rePassword = param.password;
        createUserDto.roleNames = param.roleNames ?? [];

        var logged_user = param.req.user;
        const user_specification = new UsernameSpecification(logged_user.username);
        var checkLoggedUser = await this.getWithSpecification(user_specification, null,
          {
            id: true

          });
        const specification = new UsernameSpecification(createUserDto.username);
        var checkUser = await this.getWithSpecification(specification, null,
          { id: true, username: true });
        if (checkUser.length > 0) {
          if (checkUser[0].username == createUserDto.username) {
            this.history.addNewHistory({
            status:"fault",
            operation:"create_user",
            parameters:this.history.getParams(param),
            result:{
              errorMessage:message.user.Theusenameexists
            }
          },param.req.user.username)
            throw new HttpException(message.user.Theusenameexists, HttpStatus.BAD_REQUEST);
          }
        }
        var user = GenericMapper.toEntity(Users, createUserDto);
        user.createAt = new Date();
        user.recordStatus = recordStatus.Active;
        user.password = await this.passwordService.hashPassword(createUserDto.password);
        user.userId = checkLoggedUser[0].id;
        if (param.files.length > 0) {
          user.imageSrc = param.files[0];
        }

        const spec = new RoleNamesSpecification(createUserDto.roleNames);
        const roles = await this.roleService.getWithSpecification(spec, {
          select: ['id', 'name'],
        });
        if (roles.length !== createUserDto.roleNames.length) {
            this.history.addNewHistory({
            status:"fault",
            operation:"create_user",
            parameters:this.history.getParams(param),
            result:{
              errorMessage:message.user.Somerolesnotfound
            }
          },param.req.user.username)
          throw new HttpException(message.user.Somerolesnotfound, HttpStatus.BAD_REQUEST);
        }

        var createResult = await this.createUserWithRole(user, roles);

        var response_result = GenericMapper.toDto(UserDto, createResult, { excludeExtraneousValues: true });

                this.history.addNewHistory({
          status:"success",
          operation:"create_user",
          parameters:this.history.getParams(param),
          result:{
            "id":createResult.id.toString(),
            "username":createResult.username,
            "password":createResult.password,
            "createAt":createResult.createAt.toString(),
            "recordStatus":createResult.recordStatus.toString(),
            "roles":createResult.userRoles.join(",")
          }
        },param.req.user.username)


          return {
          continuePrompt:undefined,
          toolName:"create_user"
        };
      }
    })


    this.toolRtegister.register({
      functionName: "update_user",
      handler: async (param: any): Promise<RequestResult> => {
        if (param.username == "" || param.username == null) {
          this.history.addNewHistory({
            status:"fault",
            operation:"update_user",
            parameters:this.history.getParams(param),
            result:{
              errorMessage:message.user.usernamerequired
            }
          },param.req.user.username)
          throw new HttpException(message.user.usernamerequired, HttpStatus.BAD_REQUEST);
        }
        const dto = new UserUpdateDto();
        dto.imageSrc = param.files[0];
        dto.recordStatus = param.recordStatus;
        dto.username = param.newusername;

        var user = await this.userRepository.getByUserName(param.username);
        if (!user) {
          this.history.addNewHistory({
            status:"fault",
            operation:"update_user",
            parameters:this.history.getParams(param),
            result:{
              errorMessage:message.user.Usernotfound
            }
          },param.req.user.username)

          throw new HttpException(message.user.Usernotfound, HttpStatus.NOT_FOUND);
        }
        user.username = dto.username ?? user.username;
        user.imageSrc = dto.imageSrc ?? user.imageSrc;
        user.recordStatus = dto.recordStatus ?? user.recordStatus;
        var updatedUser = await this.update(user);
        var result = GenericMapper.toDto(UserDto, updatedUser, { excludeExtraneousValues: true });

                        this.history.addNewHistory({
          status:"success",
          operation:"update_user",
          parameters:this.history.getParams(param),
          result:{
            "id":updatedUser.id.toString(),
            "username":updatedUser.username,
            "password":updatedUser.password,
            "createAt":updatedUser.createAt.toString(),
            "recordStatus":updatedUser.recordStatus.toString(),
            "roles":updatedUser.roles.join(",")
          }
        },param.req.user.username)

           return {
          continuePrompt:undefined,
          toolName:"update_user"
        };
      }
    })


    this.toolRtegister.register({
      functionName: "update_user_record_status",
      handler: async (param: any): Promise<RequestResult> => {
        if (param.username == "" || param.username == null) {
           this.history.addNewHistory({
            status:"fault",
            operation:"update_user_record_status",
            parameters:this.history.getParams(param),
            result:{
              errorMessage:message.user.usernamerequired
            }
          },param.req.user.username)
          throw new HttpException(message.user.usernamerequired, HttpStatus.BAD_REQUEST);
        }
        const dto = new UserUpdateDto();
        dto.recordStatus = param.recordStatus;

        var user = await this.userRepository.getByUserName(param.username);
        if (!user) {
           this.history.addNewHistory({
            status:"fault",
            operation:"update_user_record_status",
            parameters:this.history.getParams(param),
            result:{
              errorMessage:message.user.Usernotfound
            }
          },param.req.user.username)
          throw new HttpException(message.user.Usernotfound, HttpStatus.NOT_FOUND);
        }
        user.recordStatus = dto.recordStatus ?? user.recordStatus;
        var updatedUser = await this.update(user);
        var result = GenericMapper.toDto(UserDto, updatedUser, { excludeExtraneousValues: true });

        this.history.addNewHistory({
          status:"success",
          operation:"update_user_record_status",
          parameters:this.history.getParams(param),
          result:{
            "id":updatedUser.id.toString(),
            "username":updatedUser.username,
            "password":updatedUser.password,
            "createAt":updatedUser.createAt.toString(),
            "recordStatus":updatedUser.recordStatus.toString(),
          }
        },param.req.user.username)



           return {
          continuePrompt:undefined,
          toolName:"update_user_record_status"
        };
      }
    })

    this.toolRtegister.register({
      functionName: "delete_user",
      handler: async (param: any): Promise<RequestResult> => {
        if (param.username == "" || param.username == null) {
          this.history.addNewHistory({
            status:"fault",
            operation:"update_user",
            parameters:this.history.getParams(param),
            result:{
              errorMessage:message.user.usernamerequired
            }
          },param.req.user.username)
          throw new HttpException(message.user.usernamerequired, HttpStatus.BAD_REQUEST);
        }
        const dto = new UserUpdateDto();

        var user = await this.userRepository.getByUserName(param.username);
        if (!user) {
          this.history.addNewHistory({
            status:"fault",
            operation:"update_user",
            parameters:this.history.getParams(param),
            result:{
              errorMessage:message.user.Usernotfound
            }
          },param.req.user.username)
          throw new HttpException(message.user.Usernotfound, HttpStatus.NOT_FOUND);
        }
        var updatedUser = await this.deleteUserWithRoles(user.id);
        var result = GenericMapper.toDto(UserDto, updatedUser, { excludeExtraneousValues: true });

        this.history.addNewHistory({
          status:"success",
          operation:"delete_user",
          parameters:this.history.getParams(param),
          result:{
            "id":user.id.toString()
          }
        },param.req.user.username)
         return {
          continuePrompt:undefined,
          toolName:"delete_user"
        };
      }
    })

    this.toolRtegister.register({
      functionName: "change-user-password",
      handler: async (param: any): Promise<RequestResult> => {
        if (param.username == "" || param.username == null) {
           this.history.addNewHistory({
            status:"fault",
            operation:"change-user-password",
            parameters:this.history.getParams(param),
            result:{
              errorMessage:message.user.usernamerequired
            }
          },param.req.user.username)
          throw new HttpException(message.user.usernamerequired, HttpStatus.BAD_REQUEST);
        }
        const dto = new changePasswordDto();
        dto.username = param.username;
        dto.currentPassword = param.currentPassword;
        dto.newPassword = param.newPassword;
        const specification = new UsernameSpecification(dto.username);
        var checkUser = await this.getWithSpecification(specification, null,
          { id: true, username: true, password: true });
        if (checkUser.length < 1) {

           this.history.addNewHistory({
            status:"fault",
            operation:"change-user-password",
            parameters:this.history.getParams(param),
            result:{
              errorMessage:message.user.Usernotfound
            }
          },param.req.user.username)

          throw new HttpException(message.user.Usernotfound, HttpStatus.NOT_FOUND);
        }

        var checkPass = await this.passwordService.comparePasswords(dto.currentPassword, checkUser[0].password);
        if (!checkPass) {
          this.history.addNewHistory({
            status:"fault",
            operation:"change-user-password",
            parameters:this.history.getParams(param),
            result:{
              errorMessage:message.user.passwordisincorrect
            }
          },param.req.user.username)
          throw new HttpException(message.user.passwordisincorrect, HttpStatus.BAD_REQUEST);
        }
        var user = checkUser[0];

        user.password = await this.passwordService.hashPassword(dto.newPassword);

        var createResult = await this.update(user);

        var response_result = GenericMapper.toDto(UserDto, createResult, { excludeExtraneousValues: true });
         
                this.history.addNewHistory({
          status:"success",
          operation:"change-user-password",
          parameters:this.history.getParams(param),
          result:{
            "id":createResult.id.toString(),
            "username":createResult.username,
            "password":createResult.password,
            "createAt":createResult.createAt.toString(),
            "recordStatus":createResult.recordStatus.toString(),
            "roles":createResult.roles.join(",")
          }
        },param.req.user.username)

        return {
          continuePrompt:undefined,
          toolName:"change-user-password"
        };
      }
    })


    this.toolRtegister.register({
      functionName: "assign-user-roles",
      handler: async (param: any): Promise<RequestResult> => {
        if (param.username == "" || param.username == null) {
                     this.history.addNewHistory({
            status:"fault",
            operation:"assign-user-roles",
            parameters:this.history.getParams(param),
            result:{
              errorMessage:message.user.usernamerequired
            }
          },param.req.user.username)

          throw new HttpException(message.user.usernamerequired, HttpStatus.BAD_REQUEST);
        }
        const dto = new CreateUserRolesDto();


          const current_user = param.req.user;
          const user_specification = new UsernameSpecification(current_user.username);
          const checkUser = await this.getWithSpecification(user_specification, null, { id: true });
          if (!checkUser || checkUser.length === 0) {

             this.history.addNewHistory({
            status:"fault",
            operation:"assign-user-roles",
            parameters:this.history.getParams(param),
            result:{
              errorMessage:message.user.Usernotfound
            }
          },param.req.user.username)


            throw new HttpException(message.user.Usernotfound, HttpStatus.NOT_FOUND);
          }
      
      
      
          const user =  await this.userRepository.getByUserName(param.username);
          if (!user) {
            this.history.addNewHistory({
            status:"fault",
            operation:"assign-user-roles",
            parameters:this.history.getParams(param),
            result:{
              errorMessage:message.user.Usernotfound
            }
          },param.req.user.username)
            throw new HttpException(message.user.Usernotfound, HttpStatus.NOT_FOUND);
          }
      
      
          const roles = await this.roleService.getWithSpecification(
            new RoleIdsSpecification(dto.roleIds)
          );
          if (!roles || roles.length !== dto.roleIds.length) {
            this.history.addNewHistory({
            status:"fault",
            operation:"assign-user-roles",
            parameters:this.history.getParams(param),
            result:{
              errorMessage:message.user.Somerolesnotfound
            }
          },param.req.user.username)
            throw new HttpException(message.user.Somerolesnotfound, HttpStatus.BAD_REQUEST);
          }
      
          // ساخت RoleSystemOperations برای هر operation
          const items: UserRoles[] = [];
          for (const op of roles) {
            const item = new UserRoles();
            item.assigendUser = user;
            item.role = op;
            item.user = checkUser[0];
            item.createAt = new Date();
            item.recordStatus = recordStatus.Active;
            items.push(item);
          }
      
      
          await this.assignRolesToUser(items);
      
          const userWithOperations = await this.getUserWithRoleAndOperations(user.id);
      
          const result = GenericMapper.toDto(UserDto, userWithOperations, { excludeExtraneousValues: true });
        
         this.history.addNewHistory({
          status:"success",
          operation:"assign-user-roles",
          parameters:this.history.getParams(param),
          result:{
            "id":user.id.toString(),
            "roles":items.join(",")
          }
        },param.req.user.username)


          return {
          continuePrompt:undefined,
          toolName:"assign-user-roles"
        };
      }
    })




  }


  async createUserWithRole(
    userData: Partial<Users>,
    roleName: Roles[],
    /*   heardAbout: UserHeardAboutUsDto[] */
  ): Promise<Users> {
    return this.userRepository.createUserWithRole(userData, roleName);
  }

  async remove(id: string): Promise<void> {
    await this.userRepository.remove(id);
  }

  async assignOperationsToUser(items: UserMenuOperations[], mainUserId: string): Promise<void> {
    /*     if (items.length > 0) {
          const userId = items[0].mainUser.id; */
    // حذف عملیات قبلی مرتبط با این Role
    await this.userMenuOperationsRepository.deleteByUserId(mainUserId);
    /*   } */
    // ذخیره عملیات جدید
    await this.userMenuOperationsRepository.addMany(items);
  }
  async assignRolesToUser(items: UserRoles[]): Promise<void> {
    if (items.length > 0) {
      const userId = items[0].assigendUser.id;
      // حذف عملیات قبلی مرتبط با این Role
      await this.userRoleRepository.deleteByUserId(userId);
    }
    // ذخیره عملیات جدید
    await this.userRoleRepository.addMany(items);
  }
  async getAllUserWithRoleAndOperations(): Promise<Users[]> {
    return this.userRepository.getAllUserWithRoleAndOperations();
  }
  async getUserWithRoleAndOperations(userId: string): Promise<Users> {
    return this.userRepository.getUserWithRoleAndOperations(userId);
  }

  async deleteUserWithRoles(userId: string): Promise<void> {
    this.userRepository.deleteUserWithRoles(userId);
  }
}
