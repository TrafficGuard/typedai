export interface IExample {
    code: string;
    reviewComment: string;
}

export interface CodeReviewFileExtensions {
    include: string[];
}

export interface CodeReviewRequires {
    text: string[];
}

// The code review fastify route schema and angular form group names must match the interface property names
export interface CodeReviewConfig {
    id: string;
    title: string;
    enabled: boolean;
    description: string;
    fileExtensions: CodeReviewFileExtensions;
    requires: CodeReviewRequires;
    tags: string[];
    projectPaths: string[];
    examples: IExample[];
}
