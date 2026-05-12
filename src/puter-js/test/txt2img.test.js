/* eslint-disable */
// TODO: Make these more compatible with eslint

// Core test functions for txt2img functionality
const testTxt2ImgBasicCore = async function() {
    const result = await puter.ai.txt2img("A red circle on a white background", true);

    assert(result instanceof Image, "txt2img should return an Image object");
    assert(result !== null, "txt2img should not return null");

    assert(typeof result.src === 'string', "result should have src property as string");
    assert(result.src.length > 0, "src should not be empty");

    const isValidUrl = result.src.startsWith('blob:') ||
                       result.src.startsWith('data:') ||
                       result.src.startsWith('http:') ||
                       result.src.startsWith('https:');
    assert(isValidUrl, `src should be a valid URL, got: ${result.src.substring(0, 80)}`);

    assert(typeof result.toString === 'function', "result should have toString method");
    assert(typeof result.valueOf === 'function', "result should have valueOf method");
    assert(result.toString() === result.src, "toString() should return src");
    assert(result.valueOf() === result.src, "valueOf() should return src");
};

const testTxt2ImgWithOptionsCore = async function() {
    const result = await puter.ai.txt2img("A blue square", {
        test_mode: true,
    });

    assert(result instanceof Image, "txt2img with options should return an Image object");
    assert(result !== null, "txt2img with options should not return null");

    assert(typeof result.src === 'string', "result should have src property as string");
    assert(result.src.length > 0, "src should not be empty");

    assert(result.toString() === result.src, "toString() should return src");
    assert(result.valueOf() === result.src, "valueOf() should return src");
};

const testTxt2ImgObjectSyntaxCore = async function() {
    const result = await puter.ai.txt2img({
        prompt: "A green triangle",
        test_mode: true,
    });

    assert(result instanceof Image, "txt2img object syntax should return an Image object");
    assert(result !== null, "txt2img object syntax should not return null");

    assert(typeof result.src === 'string', "result should have src property as string");
    assert(result.src.length > 0, "src should not be empty");
};

const testTxt2ImgPuterOutputPathCore = async function() {
    const outputPath = `test_output_${Date.now()}.png`;

    const result = await puter.ai.txt2img("A yellow star on black background", {
        test_mode: true,
        puter_output_path: outputPath,
    });

    assert(result instanceof Image, "txt2img with puter_output_path should return an Image object");
    assert(result !== null, "txt2img with puter_output_path should not return null");
    assert(typeof result.src === 'string', "result should have src property as string");
    assert(result.src.length > 0, "src should not be empty");

    // Verify the file was written to the filesystem
    const stat = await puter.fs.stat(outputPath);
    assert(stat !== null && stat !== undefined, "file should exist at the output path");
    assert(stat.size > 0, "written file should not be empty");

    // Clean up
    await puter.fs.delete(outputPath);
};

const testTxt2ImgPuterOutputPathAbsoluteCore = async function() {
    const user = await puter.auth.getUser();
    const outputPath = `/${user.username}/test_output_abs_${Date.now()}.png`;

    const result = await puter.ai.txt2img("A purple diamond", {
        test_mode: true,
        puter_output_path: outputPath,
    });

    assert(result instanceof Image, "txt2img with absolute puter_output_path should return an Image");
    assert(typeof result.src === 'string', "result should have src as string");
    assert(result.src.length > 0, "src should not be empty");

    // Verify the file was written
    const stat = await puter.fs.stat(outputPath);
    assert(stat !== null && stat !== undefined, "file should exist at absolute output path");
    assert(stat.size > 0, "written file should not be empty");

    // Clean up
    await puter.fs.delete(outputPath);
};

const testTxt2ImgPuterOutputPathHomeTildeCore = async function() {
    const outputPath = `~/test_output_tilde_${Date.now()}.png`;

    const result = await puter.ai.txt2img("An orange hexagon", {
        test_mode: true,
        puter_output_path: outputPath,
    });

    assert(result instanceof Image, "txt2img with ~ puter_output_path should return an Image");
    assert(typeof result.src === 'string', "result should have src as string");
    assert(result.src.length > 0, "src should not be empty");

    // Verify the file was written (resolve ~ for stat)
    const user = await puter.auth.getUser();
    const resolvedPath = outputPath.replace('~', `/${user.username}`);
    const stat = await puter.fs.stat(resolvedPath);
    assert(stat !== null && stat !== undefined, "file should exist at home-relative output path");
    assert(stat.size > 0, "written file should not be empty");

    // Clean up
    await puter.fs.delete(resolvedPath);
};

const testTxt2ImgPuterOutputPathPermissionDeniedCore = async function() {
    let caught = false;
    let caughtError = null;
    try {
        await puter.ai.txt2img("A test image", {
            test_mode: true,
            puter_output_path: "/some_other_user/no_access/image.png",
        });
    } catch (error) {
        caught = true;
        caughtError = error;
    }

    assert(caught, "txt2img should throw when writing to a path without permission");
    assert(caughtError !== null, "error should not be null");

    // The error should contain the actual backend error, NOT the generic
    // "Unexpected image response format" message
    const errMsg = typeof caughtError === 'string' ? caughtError
        : caughtError?.error?.message ?? caughtError?.message ?? '';
    const errCode = caughtError?.error?.code ?? caughtError?.code ?? '';

    assert(
        !errMsg.includes('Unexpected image response format'),
        `Should surface the real backend error, not the generic 'Unexpected image response format'. Got: ${errMsg}`
    );
    assert(
        errCode !== 'invalid_image_response',
        `Error code should not be 'invalid_image_response'. Got code: ${errCode}, message: ${errMsg}`
    );
};

// Export test functions
window.txt2imgTests = [
    {
        name: "testTxt2ImgBasic",
        description: "Test basic text-to-image generation with test mode and verify Image object structure",
        test: async function() {
            try {
                await testTxt2ImgBasicCore();
                pass("testTxt2ImgBasic passed");
            } catch (error) {
                fail("testTxt2ImgBasic failed:", error);
            }
        }
    },

    {
        name: "testTxt2ImgWithOptions",
        description: "Test txt2img with prompt string and options object",
        test: async function() {
            try {
                await testTxt2ImgWithOptionsCore();
                pass("testTxt2ImgWithOptions passed");
            } catch (error) {
                fail("testTxt2ImgWithOptions failed:", error);
            }
        }
    },

    {
        name: "testTxt2ImgObjectSyntax",
        description: "Test txt2img with single options object containing prompt",
        test: async function() {
            try {
                await testTxt2ImgObjectSyntaxCore();
                pass("testTxt2ImgObjectSyntax passed");
            } catch (error) {
                fail("testTxt2ImgObjectSyntax failed:", error);
            }
        }
    },

    {
        name: "testTxt2ImgPuterOutputPath",
        description: "Test that puter_output_path writes the generated image to the Puter filesystem (relative path)",
        test: async function() {
            try {
                await testTxt2ImgPuterOutputPathCore();
                pass("testTxt2ImgPuterOutputPath passed");
            } catch (error) {
                fail("testTxt2ImgPuterOutputPath failed:", error);
            }
        }
    },

    {
        name: "testTxt2ImgPuterOutputPathAbsolute",
        description: "Test puter_output_path with an absolute path",
        test: async function() {
            try {
                await testTxt2ImgPuterOutputPathAbsoluteCore();
                pass("testTxt2ImgPuterOutputPathAbsolute passed");
            } catch (error) {
                fail("testTxt2ImgPuterOutputPathAbsolute failed:", error);
            }
        }
    },

    {
        name: "testTxt2ImgPuterOutputPathHomeTilde",
        description: "Test puter_output_path with a ~/... home-relative path",
        test: async function() {
            try {
                await testTxt2ImgPuterOutputPathHomeTildeCore();
                pass("testTxt2ImgPuterOutputPathHomeTilde passed");
            } catch (error) {
                fail("testTxt2ImgPuterOutputPathHomeTilde failed:", error);
            }
        }
    },

    {
        name: "testTxt2ImgPuterOutputPathPermissionDenied",
        description: "Test that writing to a path without permission surfaces the real backend error, not a generic one",
        test: async function() {
            try {
                await testTxt2ImgPuterOutputPathPermissionDeniedCore();
                pass("testTxt2ImgPuterOutputPathPermissionDenied passed");
            } catch (error) {
                fail("testTxt2ImgPuterOutputPathPermissionDenied failed:", error);
            }
        }
    },
];
