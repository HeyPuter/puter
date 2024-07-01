export const CreateSystemProvider = ({ puterSDK }) => {
    return {
        exit: (code) => {
            puterSDK.exit(code);
        },
    }
}
