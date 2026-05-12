/* eslint-disable */
// TODO: Make these more compatible with eslint

// Core test functions for txt2vid functionality
const testTxt2VidBasicCore = async function() {
    const result = await puter.ai.txt2vid("A sunrise over the ocean", true);

    assert(result !== null, "txt2vid should not return null");
    assert(typeof result === 'object', "txt2vid should return an object");

    // Should be a video element (or object with video-like properties in non-DOM envs)
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

const testTxt2VidWithOptionsCore = async function() {
    const result = await puter.ai.txt2vid("A cat walking through grass", {
        test_mode: true,
    });

    assert(result !== null, "txt2vid with options should not return null");
    assert(typeof result === 'object', "txt2vid with options should return an object");
    assert(typeof result.src === 'string', "result should have src as string");
    assert(result.src.length > 0, "src should not be empty");

    assert(result.toString() === result.src, "toString() should return src");
    assert(result.valueOf() === result.src, "valueOf() should return src");
};

const testTxt2VidObjectSyntaxCore = async function() {
    const result = await puter.ai.txt2vid({
        prompt: "Clouds drifting across a blue sky",
        test_mode: true,
    });

    assert(result !== null, "txt2vid object syntax should not return null");
    assert(typeof result === 'object', "txt2vid object syntax should return an object");
    assert(typeof result.src === 'string', "result should have src as string");
    assert(result.src.length > 0, "src should not be empty");
};

const testTxt2VidPuterOutputPathCore = async function() {
    const outputPath = `test_output_${Date.now()}.mp4`;

    const result = await puter.ai.txt2vid("A ball rolling down a hill", {
        test_mode: true,
        puter_output_path: outputPath,
    });

    assert(result !== null, "txt2vid with puter_output_path should not return null");
    assert(typeof result === 'object', "txt2vid with puter_output_path should return an object");
    assert(typeof result.src === 'string', "result should have src as string");
    assert(result.src.length > 0, "src should not be empty");

    // Verify the file was written to the filesystem
    const stat = await puter.fs.stat(outputPath);
    assert(stat !== null && stat !== undefined, "file should exist at the output path");
    assert(stat.size > 0, "written file should not be empty");

    // Clean up
    await puter.fs.delete(outputPath);
};

const testTxt2VidPuterOutputPathAbsoluteCore = async function() {
    const user = await puter.auth.getUser();
    const outputPath = `/${user.username}/test_output_abs_${Date.now()}.mp4`;

    const result = await puter.ai.txt2vid("Rain falling on a window", {
        test_mode: true,
        puter_output_path: outputPath,
    });

    assert(result !== null, "txt2vid with absolute puter_output_path should not return null");
    assert(typeof result.src === 'string', "result should have src as string");
    assert(result.src.length > 0, "src should not be empty");

    // Verify the file was written
    const stat = await puter.fs.stat(outputPath);
    assert(stat !== null && stat !== undefined, "file should exist at absolute output path");
    assert(stat.size > 0, "written file should not be empty");

    // Clean up
    await puter.fs.delete(outputPath);
};

const testTxt2VidPuterOutputPathHomeTildeCore = async function() {
    const outputPath = `~/test_output_tilde_${Date.now()}.mp4`;

    const result = await puter.ai.txt2vid("Waves crashing on a beach", {
        test_mode: true,
        puter_output_path: outputPath,
    });

    assert(result !== null, "txt2vid with ~ puter_output_path should not return null");
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

const testTxt2VidPuterOutputPathPermissionDeniedCore = async function() {
    let caught = false;
    let caughtError = null;
    try {
        await puter.ai.txt2vid("A test video", {
            test_mode: true,
            puter_output_path: "/some_other_user/no_access/video.mp4",
        });
    } catch (error) {
        caught = true;
        caughtError = error;
    }

    assert(caught, "txt2vid should throw when writing to a path without permission");
    assert(caughtError !== null, "error should not be null");

    // The error should contain the actual backend error, NOT a generic message
    const errMsg = typeof caughtError === 'string' ? caughtError
        : caughtError?.error?.message ?? caughtError?.message ?? '';
    const errCode = caughtError?.error?.code ?? caughtError?.code ?? '';

    assert(
        errCode !== 'invalid_video_response',
        `Error code should not be generic. Got code: ${errCode}, message: ${errMsg}`
    );
};

// Export test functions
window.txt2vidTests = [
    {
        name: "testTxt2VidBasic",
        description: "Test basic text-to-video generation with test mode and verify video element structure",
        test: async function() {
            try {
                await testTxt2VidBasicCore();
                pass("testTxt2VidBasic passed");
            } catch (error) {
                fail("testTxt2VidBasic failed:", error);
            }
        }
    },

    {
        name: "testTxt2VidWithOptions",
        description: "Test txt2vid with prompt string and options object",
        test: async function() {
            try {
                await testTxt2VidWithOptionsCore();
                pass("testTxt2VidWithOptions passed");
            } catch (error) {
                fail("testTxt2VidWithOptions failed:", error);
            }
        }
    },

    {
        name: "testTxt2VidObjectSyntax",
        description: "Test txt2vid with single options object containing prompt",
        test: async function() {
            try {
                await testTxt2VidObjectSyntaxCore();
                pass("testTxt2VidObjectSyntax passed");
            } catch (error) {
                fail("testTxt2VidObjectSyntax failed:", error);
            }
        }
    },

    {
        name: "testTxt2VidPuterOutputPath",
        description: "Test that puter_output_path writes the generated video to the Puter filesystem (relative path)",
        test: async function() {
            try {
                await testTxt2VidPuterOutputPathCore();
                pass("testTxt2VidPuterOutputPath passed");
            } catch (error) {
                fail("testTxt2VidPuterOutputPath failed:", error);
            }
        }
    },

    {
        name: "testTxt2VidPuterOutputPathAbsolute",
        description: "Test puter_output_path with an absolute path",
        test: async function() {
            try {
                await testTxt2VidPuterOutputPathAbsoluteCore();
                pass("testTxt2VidPuterOutputPathAbsolute passed");
            } catch (error) {
                fail("testTxt2VidPuterOutputPathAbsolute failed:", error);
            }
        }
    },

    {
        name: "testTxt2VidPuterOutputPathHomeTilde",
        description: "Test puter_output_path with a ~/... home-relative path",
        test: async function() {
            try {
                await testTxt2VidPuterOutputPathHomeTildeCore();
                pass("testTxt2VidPuterOutputPathHomeTilde passed");
            } catch (error) {
                fail("testTxt2VidPuterOutputPathHomeTilde failed:", error);
            }
        }
    },

    {
        name: "testTxt2VidPuterOutputPathPermissionDenied",
        description: "Test that writing to a path without permission surfaces the real backend error",
        test: async function() {
            try {
                await testTxt2VidPuterOutputPathPermissionDeniedCore();
                pass("testTxt2VidPuterOutputPathPermissionDenied passed");
            } catch (error) {
                fail("testTxt2VidPuterOutputPathPermissionDenied failed:", error);
            }
        }
    },
];
