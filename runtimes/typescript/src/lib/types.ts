import type { AuthContext } from "../auth/types.js";

export type AppEnv = {
	Variables: {
		requestId: string;
		auth: AuthContext;
	};
};
