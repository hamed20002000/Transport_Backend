import { Injectable } from '@nestjs/common';
import { DataSource, TreeRepository } from 'typeorm';
import { BaseRepository } from '../base.repository';
import { Categories } from 'src/domain/entities/Categories';

@Injectable()
export class CategoryRepository extends BaseRepository<Categories> {
    private readonly treeRepository: TreeRepository<Categories>;

    constructor(private readonly dataSource: DataSource) {
        const treeRepo = dataSource.getTreeRepository(Categories);
        super(treeRepo);
        this.treeRepository = treeRepo;
    }


    async findAllTrees(): Promise<Categories[]> {
        return this.treeRepository.findTrees();
    }

    async findDescendants(id: number): Promise<Categories> {
        const node = await this.treeRepository.findOneBy({ id: id });
        if (!node) {
            throw new Error('Category not found');
        }
        return this.treeRepository.findDescendantsTree(node);
    }
    async updateChildrenDepth(id: number): Promise<void> {
        const parent = await this.treeRepository.findOneBy({ id });
        if (!parent) {
            throw new Error('Category not found');
        }
        const tree = await this.treeRepository.findDescendantsTree(parent);

        const updateDepth = async (node: Categories, parentDepth: number) => {
            if (node.categories && node.categories.length > 0) {
                for (const child of node.categories) {
                    child.depth = parentDepth + 1;
                    await this.treeRepository.save(child);
                    await updateDepth(child, child.depth);
                }
            }
        };

        await updateDepth(tree, parent.depth ?? 0);
    }

    async findByName(name: string): Promise<Categories> {
        return await this.repository
            .createQueryBuilder("category")
            .leftJoinAndSelect("category.parent", "parent")
            .where(
                `regexp_replace(trim(category."Name"), '\s+', ' ', 'g') = regexp_replace(trim(:name), '\s+', ' ', 'g')`,
                { name }
            )
            .getOne();
    }
}
