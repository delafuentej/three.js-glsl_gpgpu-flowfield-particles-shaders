uniform float uTime;
uniform float uDeltaTime;
uniform sampler2D uBase;
uniform float uFlowfieldInfluence;
uniform float uFlowfieldStrength;
uniform float uFlowfieldFrecuency;

#include ../includes/simplexNoise4d.glsl
 
 void main(){
    float time = uTime * 0.2;
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec4 particle = texture(uParticles, uv);
     vec4 base = texture(uBase, uv);

      //particle dead:
      //particle alpha
    if(particle.a >= 1.0){
        particle.a = mod(particle.a, 1.0);
        particle.xyz = base.xyz;
    }else{
        //particle alive:

        //strength
        float strength = simplexNoise4d(vec4(base.xyz * 0.2, time + 1.0));
        float influence = (uFlowfieldInfluence - 0.5) * (-2.0);//from 1 to -1
        strength = smoothstep(influence, 1.0, strength);


         //Flow field
    vec3 flowField = vec3(
        simplexNoise4d(vec4(particle.xyz * uFlowfieldFrecuency + 0.0, time)),
        simplexNoise4d(vec4(particle.xyz * uFlowfieldFrecuency + 1.0, time)),
        simplexNoise4d(vec4(particle.xyz * uFlowfieldFrecuency + 2.0 , time))
    );

    flowField = normalize(flowField);
    particle.xyz += flowField * uDeltaTime * strength * uFlowfieldStrength;

    //Decay
    particle.a += uDeltaTime * 0.3;
    }

   
  
    gl_FragColor = particle;
 }