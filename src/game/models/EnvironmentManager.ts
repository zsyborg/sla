import GameState from "./GameState";
import EnvironmentSet from "./EnvironmentSet";
import { ENVIRONMENT_SET_TEMPLATES, EVENTS, ROOM_TRANSITION_ASSETS } from "../../constants";
import * as THREE from "three";
import { GraphicsPreset } from "../enums/GraphicsPresset";
import { Settings } from "./Settings";

export default class EnvironmentManager {

    public activeTransition : Transition | null = null;
    private transitions : Transition[] = [];

    private static instance : EnvironmentManager;

    private gameState : GameState;

    private environmentSets : EnvironmentSet[] = [];
    private activeSet : EnvironmentSet;
    private nextActiveSet : EnvironmentSet;

    private pointLightPool : PoolLight[] = [];
    private maxPointLights = 13; 

    private lastTransitionDistance = 0;
    private nextTransitionOffset = 10;

    private transitionOffsetVariance = 20;
    private transitionOffsetMin = 40;

    private constructor() {
        this.gameState = GameState.getInstance();
        let prevSettings = {...this.gameState.settings} as Settings;
        this.transitionOffsetVariance = this.gameState.settings.rushMode ? 20 : 40;
        this.transitionOffsetMin = this.gameState.settings.rushMode ? 50 : 65;

        for(const template of ENVIRONMENT_SET_TEMPLATES) {
            const environmentSet = new EnvironmentSet(template);
            this.environmentSets.push(environmentSet);
        }

        this.activeSet = this.environmentSets[0];
        this.nextActiveSet = this.environmentSets[1];

        this.setupInitialSet();

        this.gameState.addLogicHandler(this.update);

        // Generate pool of point lights that can be used for lamps 
        for(let i = 0; i < this.maxPointLights; i++) {
            const pointLight = new THREE.PointLight(0xffffff, 0, 0, 2);
            pointLight.castShadow = false;
            this.pointLightPool.push(new PoolLight(pointLight, 5.2));
            this.gameState.sceneAdd(pointLight);
        }

        this.setupTransition();

        this.gameState.addEventListener(EVENTS.settingsChanged, () => {
            if(this.gameState.settings.graphicsPreset !== prevSettings.graphicsPreset) {
                prevSettings = {...this.gameState.settings} as Settings;
                this.updateSettings();
                for(const set of this.environmentSets) {
                    set.updateSettings();
                }

                this.gameState.reset();
            }

            this.transitionOffsetVariance = this.gameState.settings.rushMode ? 20 : 40;
            this.transitionOffsetMin = this.gameState.settings.rushMode ? 50 : 65;
        });

        this.nextTransitionOffset = Math.random() * this.transitionOffsetVariance + this.transitionOffsetMin;
    }

    public static getInstance() : EnvironmentManager {
        if(this.instance == null) this.instance = new EnvironmentManager();
        return this.instance;
    }

    // Get first available light in the pool
    public getAvailableLight() : PoolLight | undefined {
        return this.pointLightPool.find(l => l.isActive !== true);
    }

    public reset() {
        for(const set of this.environmentSets) {
            set.reset();
        }
        this.setupInitialSet();
        this.lastTransitionDistance = 0;
        for(const transition of this.transitions) {
            transition.reset();
        }
    }

    private update = (delta : number) => {
        // Switch between sets
        if(!this.activeSet.update(delta)) {
            this.activeSet.isActive = false;
            this.activeSet = this.nextActiveSet;
            this.activeSet.isActive = true;
            const availableSets = this.environmentSets.filter(set => set !== this.activeSet);
            const underUsed = availableSets.find(s => s.lastUsed >= 3);
            this.nextActiveSet = underUsed ?? availableSets[Math.floor(Math.random() * availableSets.length)];
            for(const set of this.environmentSets.filter(s => s !== this.nextActiveSet)) {
                set.lastUsed++;
            }
        }

        this.nextActiveSet.update(delta);

        // Update and play transition animations
        if(this.activeTransition?.isActive) {
            this.activeTransition.update(delta);
        }

        // Move lights in the light pool
        for(const light of this.pointLightPool) {
            if(light.isActive) {
                light.moveBy(this.gameState.movingSpeed * delta);
            }
        }

        if(this.gameState.distanceTravelled - this.lastTransitionDistance > this.nextTransitionOffset) {
            this.makeTransition();
            const end = Math.abs(this.activeTransition?.getBounds().min.z ?? 0);
            this.lastTransitionDistance = this.gameState.distanceTravelled + end;
        }
    };

    // Start the transition between 2 environment sets
    private makeTransition() {
        this.activeSet.isActive = false;
        this.nextActiveSet.setAsNext();
        this.nextActiveSet.lastUsed = 0;
        this.activeTransition = this.transitions[this.activeSet.transition ?? 0];
        this.activeTransition?.activate();
        this.nextTransitionOffset = Math.random() * this.transitionOffsetVariance + this.transitionOffsetMin;

        // Delete Lights in proximity of transition
        const bounds = this.activeTransition.getBounds();
        for(const light of this.pointLightPool) {
            const pos = light.getPosition();
            if(pos.z <= bounds.max.z + 1.5 && pos.z >= bounds.min.z - 1.5) {
                light.deactivate();
            }
        }
    }

    // Load transition model and setup animations
    private setupTransition() {
        for(const asset of ROOM_TRANSITION_ASSETS) {
            this.gameState.loadGLTF(`/3d_assets/${asset}`, (gltf) => {
                this.transitions.push(new Transition(gltf.scene, gltf.animations));
            });
        }
    }

    private setupInitialSet() {
        const availableInitial = this.environmentSets.filter(set => !set.notInitial);
        this.activeSet = availableInitial[Math.floor(Math.random() * availableInitial.length)];
        const availableNext = this.environmentSets.filter(set => set !== this.activeSet);
        this.nextActiveSet = availableNext[Math.floor(Math.random() * availableNext.length)];
    
        this.activeSet.isActive = true;
        this.nextActiveSet.isActive = false;

        for(const set of this.environmentSets) {
            set.lastUsed = 0;
        }
    }

    private updateSettings() {
        if(this.gameState.settings.graphicsPreset === GraphicsPreset.LOW) {
            this.maxPointLights = 8;
        }
        else {
            this.maxPointLights = 13;
        }
    }
}

class PoolLight {
    public isActive : boolean;
  
    private light : THREE.Light;
    private activeIntesitiy : number;

    constructor(light : THREE.Light, activeIntesity : number) {
        this.light = light;
        this.activeIntesitiy = activeIntesity;
        this.isActive = false;
    }

    public activate(position : THREE.Vector3) {
        this.light.intensity = this.activeIntesitiy;
        this.isActive = true;
        this.light.position.copy(position);
    }

    public deactivate() {
        this.light.intensity = 0;
        this.isActive = false;
    }

    public moveBy(z : number) {
        this.light.position.z += z;
        if(this.light.position.z >= 10) {
            this.deactivate();
        }
    }

    public getPosition() {
        return this.light.position;
    }
}

class Transition {
    public isActive = false;

    private gameState : GameState;

    private model = new THREE.Object3D();
    private mixer : THREE.AnimationMixer;
    private animations : TransitionAnimation[] = [];

    private bounds = new THREE.Box3();
    private size = new THREE.Vector3();

    private readonly baseBounds = new THREE.Box3(new THREE.Vector3(-Infinity, -Infinity, -Infinity), new THREE.Vector3(-Infinity, -Infinity, -Infinity));

    constructor(model : THREE.Object3D, animations : THREE.AnimationClip[]) {
        this.gameState = GameState.getInstance();

        this.mixer = new THREE.AnimationMixer(model);
        this.mixer.timeScale = 0.5;

        for(const child of model.children) {
            const clip = animations.find(c => c.name.replace(".", "") === child.name);
            if(!clip) continue;
            const animation = this.mixer.clipAction(clip);
            animation.setLoop(THREE.LoopOnce, 1);
            animation.clampWhenFinished = true;
            this.animations.push(new TransitionAnimation(child, animation));
        }

        this.model = model;

        this.gameState.sceneAdd(this.model);
        this.gameState.addEventListener(EVENTS.load, () => {
            this.model.visible = false;
        });

        this.bounds.setFromObject(model);
        this.bounds.getSize(this.size);
    }

    public getBounds() {
        if(!this.isActive) {
            return this.baseBounds;
        }

        this.bounds.setFromObject(this.model);
        return this.bounds;
    }

    public getSize() {
        return this.size;
    }

    // Makes transition visible and resets animations
    public activate() {
        this.isActive = true;
        this.model.position.z = -65;
        this.model.visible = true;
        for(const animation of this.animations) {
            animation.action.stop();
            animation.isActive = false;
        }
    }

    // Update animation mixer, start animations when necessary
    public update(delta : number) {
        this.mixer.update(delta);
        this.model.position.z += this.gameState.movingSpeed * delta;
        for(const animation of this.animations) {
            const position = new THREE.Vector3();
            animation.model.getWorldPosition(position);
            if(position.z >= -5) {
                animation.isActive = true;
                animation.action.play();
            }
        }

        if(this.model.position.z >= 20) {
            this.isActive = false;
            this.model.visible = false;
        }
    }

    public reset() {
        this.isActive = false;
        this.model.visible = false;
    }
}

class TransitionAnimation {
    public model : THREE.Object3D;
    public action : THREE.AnimationAction;
    public isActive = false;

    constructor(model : THREE.Object3D, action : THREE.AnimationAction) {
        this.model = model;
        this.action = action;
    }
}