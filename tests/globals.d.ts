declare global {
	var __vscodeMock: {
		config: Record<string, unknown>;
		language: string;
		reset(): void;
	};
}

export {};
