import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';


import { BaseRepository } from '../base.repository';
import { DataSource, EntityManager, In, QueryRunner, Repository } from 'typeorm';
import { Users } from 'src/domain/entities/Users';
import { Roles } from 'src/domain/entities/Roles';
import { UserRoles } from 'src/domain/entities/UserRoles';


import { GenericMapper } from 'src/presentation/helpers/mapper-classes';
import { recordStatus } from 'src/domain/enums/recordstatus.enum';
import { UserMenuOperations } from 'src/domain/entities/UserMenuOperations';





@Injectable()
export class UserRepository extends BaseRepository<Users> {
  constructor(@InjectRepository(Users) repository: Repository<Users>, private readonly dataSource: DataSource) {
    super(repository);
  }


  async createUserWithRole(
    userData: Partial<Users>,
    roles: Roles[],
  ): Promise<Users> {
    return this.dataSource.transaction(async (manager: EntityManager) => {

      const userRepo = manager.getRepository(Users);
      const newUser = userRepo.create(userData);
      const savedUser = await userRepo.save(newUser);


      if (roles?.length) {
        const urRepo = manager.getRepository(UserRoles);

        const userRoles = roles.map((role) =>
          urRepo.create({
            role: role,
            user: savedUser,
            createAt: new Date(),
            recordStatus: recordStatus.Active,
            assigendUser: savedUser
          }),
        );

        await urRepo.save(userRoles);
        savedUser.userRoles = userRoles;
      }

      return savedUser;
    });
  }

  async remove(id: string): Promise<void> {
    await this.repository.delete(id);
  }

  async getAllUserWithRoleAndOperations(): Promise<Users[]> {
    return this.repository.find({
      relations: ['userMenuOperations', 'userMenuOperations.menuOperation','userMenuOperations.menuOperation.systemOperation', 'userRoles', 'userRoles.role'],
    });
  }

  async getUserWithRoleAndOperations(userId: string): Promise<Users> {
    return this.repository.findOne({
      where: { id: userId },
      relations: ['userMenuOperations', 'userMenuOperations.menuOperation','userMenuOperations.menuOperation.systemOperation', 'userRoles', 'userRoles.role'],
    } as any);
  }
  async deleteUserWithRoles(userId: string): Promise<void> {
    await this.dataSource.transaction(async (manager: EntityManager) => {
// Delete user roles first
      await manager.getRepository(UserMenuOperations).delete({ mainUser: { id: userId } }); 
      // Delete user roles first
      await manager.getRepository(UserRoles).delete({ assigendUser: { id: userId } });
      // Then delete the user
      await manager.getRepository(Users).delete(userId);
    });
  }

      async getByUserName(username: string): Promise<Users> {
      return await this.repository.findOne({where:{username}})
    }
  
   async validateCredentials(username: string,password:string): Promise<Users> {
      return await this.repository.findOne({where:{username,password}})
    }

}
