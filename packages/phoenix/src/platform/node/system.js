import process from 'node:process';

export const CreateSystemProvider = () => {
    return {
        exit: (code) => {
            process.exit(code);
        },
    }
}
