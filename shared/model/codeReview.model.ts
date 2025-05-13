export interface IExample {
    code: string;
    reviewComment: string;
}

// The code review fastify route schema and angular form group names must match the interface property names
export interface CodeReviewConfig {
    id: string;
    title: string;
    enabled: boolean;
    description: string;
    fileExtensions: {
        include: string[];
    };
    requires: {
        text: string[];
    };
    tags: string[];
    projectPaths: string[];
    examples: IExample[];
}
