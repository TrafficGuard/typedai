CREATE TABLE user (
    user_id UUID PRIMARY KEY,
    email STRING,
)

CREATE TABLE agent_execution (
    execution_id UUID PRIMARY KEY,
    name TEXT,
    state TEXT, -- AGENT, FUNCTIONS, ERROR, FEEDBACK, COMPLETED
    initial_prompt TEXT,
    system_prompt TEXT,
    user_id TEXT,
    budget NUMERIC,
    budget_remaining NUMERIC,
    hil_budget NUMERIC,
    hil_count SMALLINT,
    cost NUMERIC,
    system_prompt TEXT,
    memory TEXT,
    llm_config JSONB,
    functions JSONB,
    filesystem_state JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE function_call (
    execution_id UUID UNIQUE NOT NULL,
    function_call_id SERIAL PRIMARY KEY,
    user_id TEXT,
    user_email TEXT,
    success BOOLEAN,
    class_name TEXT,
    method_name TEXT,
    arguments JSONB,
    response TEXT,
    return_type TEXT, -- text function json result
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE llm_call (
    execution_id UUID UNIQUE NOT NULL,
    llm_call_id UUID UNIQUE NOT NULL,
    user_prompt TEXT,
    system_prompt TEXT,
    class_name TEXT,
    method_name TEXT,
    response TEXT,
    return_type TEXT, -- text function json result
    error TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
