import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import {GPUComputationRenderer} from 'three/addons/misc/GPUComputationRenderer.js';
import GUI from 'lil-gui';
import particlesVertexShader from './shaders/particles/vertex.glsl';
import particlesFragmentShader from './shaders/particles/fragment.glsl';
import gpgpuParticlesShader from './shaders/gpgpu/particles.glsl';

/**
 * GPGPU FlowField: Particles move as if they are influenced by various streams pushing them around
 * - Techniques employed : 
 * 1)GPGPU:General-Purpose computing on Graphics Processing Units. It a way of using the GPU to process
 * data rather than rendering pixels for the end-user. GPGPU uses Textures, we are goint to save those textures(with thousend of pixels) in FBO (Frame Buffer Object)
 * It´s textures in wich we save the renders instead of  doing it on the canvas, using in three.js WebGLRenderTarget, to compute the position of the vertices, textures
 * that by default we don't see them & that's how we make that data persist. Each pixel will contain the position of the particle,where the RGB channels correspond
 *  to the XYZ coordinates and we are going to update that texture
 * Instead of displaying the texture, the custon shader will update the pixels, thus updating the particles. We are putting a texture on a plane  and we are reading 
 * the pixels and we are rendering in that same FBO, so that is a problem,  we need to have two of them and to invert them on each new update "ping-pong buffers"
 * - So we are not going to use the position attribute associated with geometry (position attribute vertex shader). Instead we are using the FBO generated 
 * and updates by GPGPU . On each frame, we update the FBO according to the previous FBO
 * - We need to do some computation by the GPU separately from our scene, a brand new off  screen scene
 * - PROBLEMS: 
 * - a)We cannot read and write in the same FBO ("Ping-Pong Buffers"). Solution: We need two FBO's ans switch them between renders
 * - b) Using pixel as data is difficult. There are various formats and types of a pixel
 * -c) We need to complete the setup with almost nothing on screen until it worlks. When we create your own GPGPU, we are not able to see much on the screen before it works
 *      we are going to try to render that GPGPU off screen inside a texture that we are goint to put on our actual texture, but we have 
 *  GPUComputationRenderer will do most the heavy lifting(creating the scene, handling ping-pong buffers, setting the color format, rendering...)
 * The class GPUComputationRenderer  isn't well documented, there is no info in the three.js documentation
 * 
 * 2) FLOW FIELD(like throwing a particle on a flow field following a stream): corresponds to "spatialized streams". Send a particular 3d Point, we are going to calculate the 
 * a direction according to this point. Despite we are going to use special noises functions. In this case, we do not know where the particle is going to go, the trajectory is
 * unpredictable and keeps on evolving with time (this applies to all particles)
 * - It is important to consider that doing the calculation for each frame for thousands of particles using just
 * the CPU would not be possible. Threrefore we are going to use the GPGPU
 * - We are going to calculate our flow-field on each pixel. It is going to do  all of the pixels at once, on one tick function
 */

/**
 * Base
 */
// Debug
const gui = new GUI({ width: 340 });
const debugObject = {};

// Canvas
const canvas = document.querySelector('canvas.webgl');

// Scene
const scene = new THREE.Scene();

// Loaders
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('/draco/');

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader(dracoLoader);

/**
 * Sizes
 */
const sizes = {
    width: window.innerWidth,
    height: window.innerHeight,
    pixelRatio: Math.min(window.devicePixelRatio, 2)
};

window.addEventListener('resize', () =>
{
    // Update sizes
    sizes.width = window.innerWidth;
    sizes.height = window.innerHeight;
    sizes.pixelRatio = Math.min(window.devicePixelRatio, 2);

    // Materials
    particles.material.uniforms.uResolution.value.set(sizes.width * sizes.pixelRatio, sizes.height * sizes.pixelRatio)

    // Update camera
    camera.aspect = sizes.width / sizes.height;
    camera.updateProjectionMatrix();

    // Update renderer
    renderer.setSize(sizes.width, sizes.height);
    renderer.setPixelRatio(sizes.pixelRatio);
});

/**
 * Camera
 */
// Base camera
const camera = new THREE.PerspectiveCamera(35, sizes.width / sizes.height, 0.1, 100);
camera.position.set(4.5, 4, 11);
scene.add(camera);

// Controls
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

/**
 * Renderer
 */
const renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    antialias: true,
});
renderer.setSize(sizes.width, sizes.height);
renderer.setPixelRatio(sizes.pixelRatio);

debugObject.clearColor = '#29191f';
renderer.setClearColor(debugObject.clearColor);

/**
 * Load model
 */
// with loadAsync we receive a Promise
const gltf = await gltfLoader.loadAsync('./model.glb');


console.log('gltf',gltf)
/**
 * Base Geometry
 */
const baseGeometry = {};
//baseGeometry.instance = new THREE.SphereGeometry();
baseGeometry.instance = gltf.scene.children[0].geometry;
//amount of vertices:
baseGeometry.count = baseGeometry.instance.attributes.position.count;//561 particles
//console.log('baseGeometry.color',baseGeometry.instance.attributes.color)


/**
 * GPU Compute- Object
 */
//setup:
//Each pixel of the FBO will correspond to one particke
const gpgpu = {};
// create a size property
gpgpu.size = Math.ceil(Math.sqrt(baseGeometry.count));// sqrt(561 particles)=>  24 by 24 Texture .It easy for the GPU to handle that
//instantiate the GPUComputationRenderer, it will do off-screen renders
gpgpu.computation = new GPUComputationRenderer(gpgpu.size ,gpgpu.size, renderer);
// now we need to send it the base particles as a Texture

//BASE PARTICLES:
const baseParticlesTexture = gpgpu.computation.createTexture();// this is a DataTexture, like another Texture but the pixels data set up as an array which  we can acces in  baseParticlesTexture.image
console.log('texture',baseParticlesTexture.image.data)//This is an Float32Array(count)
//Each set of 4 values correspond one particle (r,g,b,a) /´=> later we are going to put the particles position in there
//To create the particles variable: each type of data will be computed =< particles variable
for(let i = 0; i < baseGeometry.count; i++){
    // the geometry particles are located in baseGeometry.instance.attributes.position.array (3x3) (xyz)
    // the array we need to update is located in baseParticlesTexture.image.data (4x4) (rgba)
    const i3 = i * 3;
    const i4 = i * 4;
    //Position based on geometry
    baseParticlesTexture.image.data[i4 + 0] = baseGeometry.instance.attributes.position.array[i3 + 0]
    baseParticlesTexture.image.data[i4 + 1] = baseGeometry.instance.attributes.position.array[i3 + 1]
    baseParticlesTexture.image.data[i4 + 2] = baseGeometry.instance.attributes.position.array[i3 + 2]
    baseParticlesTexture.image.data[i4 + 3] = Math.random()



}
console.log(baseParticlesTexture.image.data)

// PArticles variable
gpgpu.particlesVariable = gpgpu.computation.addVariable('uParticles',gpgpuParticlesShader, baseParticlesTexture);
//particlesVariable needs to be re-injected into itself and we can use the setVariableDependencies() method
gpgpu.computation.setVariableDependencies(gpgpu.particlesVariable, [gpgpu.particlesVariable]);// second parameter: dependencies

//uniforms
gpgpu.particlesVariable.material.uniforms.uTime = new THREE.Uniform(0);
gpgpu.particlesVariable.material.uniforms.uDeltaTime = new THREE.Uniform(0);
gpgpu.particlesVariable.material.uniforms.uBase = new THREE.Uniform(baseParticlesTexture);
gpgpu.particlesVariable.material.uniforms.uFlowfieldInfluence = new THREE.Uniform(0.5);
gpgpu.particlesVariable.material.uniforms.uFlowfieldStrength = new THREE.Uniform(2);
gpgpu.particlesVariable.material.uniforms.uFlowfieldFrecuency = new THREE.Uniform(0.5);




//initialize the GPUComputationRenderer
gpgpu.computation.init();

/**
 * Debug
 */
gpgpu.debug = new THREE.Mesh(
    new THREE.PlaneGeometry(3, 3),
    new THREE.MeshBasicMaterial({
        // we want to have our particles as pixels
        map: gpgpu.computation.getCurrentRenderTarget(gpgpu.particlesVariable).texture
    })
);
gpgpu.debug.position.x = 3;
gpgpu.debug.visible = false;
scene.add(gpgpu.debug);
// we can access the GPUComputationRenderer getCurrentRendererTarget()
console.log(gpgpu.computation.getCurrentRenderTarget(gpgpu.particlesVariable).texture); //this is a wrapper for FBO
/**
 * Particles
 */

const particles = {};


// Geometry
const particlesUvArray = new Float32Array(baseGeometry.count * 2); //uv.xy
//particles.geometry = new THREE.BufferGeometry();
const sizesArray = new Float32Array(baseGeometry.count);
for(let y = 0; y < gpgpu.size; y++){
    for(let x = 0; x < gpgpu.size; x++){
        // we have access to an index going from 0  to the amount of particles:
        const i = (y * gpgpu.size + x);// num particles we have
        const i2 = i * 2;

        //Particles uv
        const uvX= (x + 0.5) / gpgpu.size; // from 0 to 1 value
        const uvY= (y + 0.5) / gpgpu.size; // from 0 to 1 value

        particlesUvArray[i2 + 0] = uvX;
        particlesUvArray[i2 + 1] = uvY;

        //size
        sizesArray[i] = Math.random();

    }
   // console.log(particlesUvArray)
}

particles.geometry = new THREE.BufferGeometry();
particles.geometry.setDrawRange(0, baseGeometry.count);// to define a range of vertices


// new attribute named "aParticlesUv"
particles.geometry.setAttribute('aParticlesUv', new THREE.BufferAttribute(particlesUvArray, 2));

particles.geometry.setAttribute('aColor', baseGeometry.instance.attributes.color);
particles.geometry.setAttribute('aSize', new THREE.BufferAttribute(sizesArray, 1));

// Material
particles.material = new THREE.ShaderMaterial({
    vertexShader: particlesVertexShader,
    fragmentShader: particlesFragmentShader,
    uniforms:
    {
        uSize: new THREE.Uniform(0.07),
        uResolution: new THREE.Uniform(new THREE.Vector2(sizes.width * sizes.pixelRatio, sizes.height * sizes.pixelRatio)),
        uParticlesTexture : new THREE.Uniform()
    }
});

// Points
//particles.points = new THREE.Points(particles.geometry, particles.material);
//particles.points = new THREE.Points(baseGeometry.instance, particles.material);
particles.points = new THREE.Points(particles.geometry, particles.material);
scene.add(particles.points);

/**
 * Tweaks
 */
gui.addColor(debugObject, 'clearColor').onChange(() => { renderer.setClearColor(debugObject.clearColor) });
gui.add(particles.material.uniforms.uSize, 'value')
    .min(0)
    .max(1)
    .step(0.001)
    .name('uSize');
gui.add(gpgpu.particlesVariable.material.uniforms.uFlowfieldInfluence, 'value')
    .min(0)
    .max(1)
    .step(0.001)
    .name('uFlowfieldInfluence');
gui.add( gpgpu.particlesVariable.material.uniforms.uFlowfieldStrength , 'value')
    .min(0)
    .max(10)
    .step(0.01)
    .name('uFlowfieldStrength');

gui.add( gpgpu.particlesVariable.material.uniforms.uFlowfieldFrecuency , 'value')
    .min(0)
    .max(1)
    .step(0.001)
    .name('uFlowfieldFrecuency');
   
   


/**
 * Animate
 */
const clock = new THREE.Clock();
let previousTime = 0;

const tick = () =>
{
    const elapsedTime = clock.getElapsedTime();
    const deltaTime = elapsedTime - previousTime;
    previousTime = elapsedTime;
    
    // Update controls
    controls.update();

     //GPGU UPDATE-  to update the particles variable on each frame
    
     gpgpu.particlesVariable.material.uniforms.uTime.value = elapsedTime;
     gpgpu.particlesVariable.material.uniforms.uDeltaTime.value = deltaTime;
     gpgpu.computation.compute();
     //update uParticlesTexture uniform using the getCurrentRenderTarger()
     particles.material.uniforms.uParticlesTexture.value = gpgpu.computation.getCurrentRenderTarget(gpgpu.particlesVariable).texture;

    // Render normal scene
    renderer.render(scene, camera);

    // Call tick again on the next frame
    window.requestAnimationFrame(tick);
};

tick();